using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace BatteryFlexBar.Native
{
    internal static class WindowsBluetoothReader
    {
        private const uint PresentAllClasses = 0x02 | 0x04;
        private const int NoMoreItems = 259;
        private const uint ByteProperty = 0x03;
        private const uint GuidProperty = 0x0D;
        private const uint BooleanProperty = 0x11;
        private const uint StringProperty = 0x12;

        private static readonly PropertyKey ContainerId = new PropertyKey("8C7ED206-3F8A-4827-B3AB-AE9E1FAEFC6C", 2);
        private static readonly PropertyKey FriendlyName = new PropertyKey("A45C254E-DF1C-4EFD-8020-67D146A850E0", 14);
        private static readonly PropertyKey DeviceDescription = new PropertyKey("A45C254E-DF1C-4EFD-8020-67D146A850E0", 2);
        // Windows exposes these PnP properties on supported Bluetooth nodes.
        private static readonly PropertyKey BatteryLevel = new PropertyKey("104EA319-6EE2-4701-BD47-8DDBF425BBE5", 2);
        private static readonly PropertyKey IsConnected = new PropertyKey("83DA6326-97A6-4088-9453-A1923F573B29", 15);

        internal sealed class Node
        {
            public Guid Container;
            public bool IsMainDevice;
            public bool? Connected;
            public int? Percentage;
            public string Name;
        }

        public static string ReadJson()
        {
            return BuildJson(ReadNodes());
        }

        private static List<Node> ReadNodes()
        {
            IntPtr devices = SetupDiGetClassDevsW(IntPtr.Zero, null, IntPtr.Zero, PresentAllClasses);
            if (devices == new IntPtr(-1)) throw new Win32Exception();

            var nodes = new List<Node>();
            try
            {
                var instance = new StringBuilder(512);
                var buffer = new byte[1024];
                var device = new DeviceInfo { Size = (uint)Marshal.SizeOf(typeof(DeviceInfo)) };
                for (uint index = 0; ; index++)
                {
                    if (!SetupDiEnumDeviceInfo(devices, index, ref device))
                    {
                        int error = Marshal.GetLastWin32Error();
                        if (error == NoMoreItems) break;
                        throw new Win32Exception(error);
                    }
                    instance.Clear();
                    if (!SetupDiGetDeviceInstanceIdW(devices, ref device, instance, instance.Capacity, IntPtr.Zero)) continue;
                    string id = instance.ToString();
                    if (!id.StartsWith("BTHENUM\\", StringComparison.OrdinalIgnoreCase) &&
                        !id.StartsWith("BTHLE\\", StringComparison.OrdinalIgnoreCase) &&
                        !id.StartsWith("BTHLEDEVICE\\", StringComparison.OrdinalIgnoreCase)) continue;

                    if (ReadProperty(devices, ref device, ContainerId, GuidProperty, buffer) != 16) continue;
                    var guid = new byte[16];
                    Buffer.BlockCopy(buffer, 0, guid, 0, guid.Length);
                    var container = new Guid(guid);
                    if (container == Guid.Empty) continue;

                    bool? connected = null;
                    if (ReadProperty(devices, ref device, IsConnected, BooleanProperty, buffer) == 1)
                    {
                        if (buffer[0] == 0xFF) connected = true;
                        if (buffer[0] == 0) connected = false;
                    }
                    int? percentage = null;
                    if (ReadProperty(devices, ref device, BatteryLevel, ByteProperty, buffer) == 1 && buffer[0] <= 100)
                    {
                        percentage = buffer[0];
                    }
                    bool main = id.StartsWith("BTHENUM\\DEV_", StringComparison.OrdinalIgnoreCase) ||
                        id.StartsWith("BTHLE\\DEV_", StringComparison.OrdinalIgnoreCase);
                    if (!main && !percentage.HasValue) continue;

                    nodes.Add(new Node
                    {
                        Container = container,
                        IsMainDevice = main,
                        Connected = connected,
                        Percentage = percentage,
                        Name = ReadName(devices, ref device, FriendlyName, buffer) ??
                            ReadName(devices, ref device, DeviceDescription, buffer)
                    });
                }
            }
            finally
            {
                SetupDiDestroyDeviceInfoList(devices);
            }
            return nodes;
        }

        internal static string BuildJson(IEnumerable<Node> nodes)
        {
            return SystemBatteryJson.Build("windows-bluetooth", SelectReadings(nodes));
        }

        private static IEnumerable<SystemBatteryReading> SelectReadings(IEnumerable<Node> nodes)
        {
            foreach (var group in nodes.GroupBy(node => node.Container).OrderBy(group => group.Key))
            {
                var main = group.Where(node => node.IsMainDevice).ToArray();
                bool mainConnected = main.Any(node => node.Connected == true);
                if (!mainConnected && main.Any(node => node.Connected == false)) continue;

                var candidates = group.Where(node => node.Percentage >= 0 && node.Percentage <= 100 &&
                    (node.Connected == true || (mainConnected && node.Connected == null))).ToArray();
                var preferred = candidates.Where(node => node.IsMainDevice && node.Connected == true).ToArray();
                if (preferred.Length == 0) preferred = candidates.Where(node => node.Connected == true).ToArray();
                if (preferred.Length == 0) preferred = candidates;
                var levels = preferred.Select(node => node.Percentage.Value).Distinct().ToArray();
                if (levels.Length != 1) continue;

                string name = main.Where(node => !string.IsNullOrWhiteSpace(node.Name))
                    .OrderByDescending(node => node.Connected == true)
                    .ThenBy(node => node.Name, StringComparer.Ordinal).Select(node => node.Name).FirstOrDefault() ??
                    preferred.Select(node => node.Name).Where(value => !string.IsNullOrWhiteSpace(value))
                        .OrderBy(value => value, StringComparer.Ordinal).FirstOrDefault() ?? "Bluetooth device";
                yield return new SystemBatteryReading(group.Key, name, levels[0]);
            }
        }

        private static string ReadName(IntPtr devices, ref DeviceInfo device, PropertyKey key, byte[] buffer)
        {
            int length = ReadProperty(devices, ref device, key, StringProperty, buffer);
            if (length < 2 || length % 2 != 0) return null;
            string name = Encoding.Unicode.GetString(buffer, 0, length).TrimEnd('\0').Trim();
            return name.Length > 0 ? name : null;
        }

        private static int ReadProperty(IntPtr devices, ref DeviceInfo device, PropertyKey key, uint expectedType, byte[] buffer)
        {
            uint type, length;
            return SetupDiGetDevicePropertyW(devices, ref device, ref key, out type, buffer,
                (uint)buffer.Length, out length, 0) && type == expectedType && length <= buffer.Length
                ? (int)length : 0;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PropertyKey
        {
            public Guid Format;
            public uint Id;

            public PropertyKey(string format, uint id)
            {
                Format = new Guid(format);
                Id = id;
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DeviceInfo
        {
            public uint Size;
            public Guid Class;
            public uint Instance;
            public IntPtr Reserved;
        }

        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern IntPtr SetupDiGetClassDevsW(IntPtr classGuid, string enumerator, IntPtr parent, uint flags);

        [DllImport("setupapi.dll", SetLastError = true)]
        private static extern bool SetupDiEnumDeviceInfo(IntPtr devices, uint index, ref DeviceInfo device);

        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern bool SetupDiGetDeviceInstanceIdW(IntPtr devices, ref DeviceInfo device, StringBuilder id,
            int size, IntPtr requiredSize);

        [DllImport("setupapi.dll", ExactSpelling = true, SetLastError = true)]
        private static extern bool SetupDiGetDevicePropertyW(IntPtr devices, ref DeviceInfo device, ref PropertyKey key,
            out uint type, [Out] byte[] value, uint size, out uint requiredSize, uint flags);

        [DllImport("setupapi.dll")]
        private static extern bool SetupDiDestroyDeviceInfoList(IntPtr devices);
    }

    internal static class WindowsBluetoothSelfTest
    {
        public static void Run()
        {
            const string empty = "{\"source\":\"windows-bluetooth\",\"devices\":[]}";
            var id = new Guid("12345678-1234-5678-90ab-1234567890ab");
            var main = new WindowsBluetoothReader.Node { Container = id, IsMainDevice = true, Connected = false, Name = "Тест \"BT\"" };
            var service = new WindowsBluetoothReader.Node { Container = id, Connected = true, Percentage = 0, Name = "Service" };
            Check(WindowsBluetoothReader.BuildJson(new[] { main, service }) == empty, "offline main node overrides cached service");
            main.Connected = true;
            string json = WindowsBluetoothReader.BuildJson(new[] { service, main });
            Check(json.Contains("\"percentage\":0") && json.Contains("Тест \\\"BT\\\"") && !json.Contains("Service"), "zero and main friendly name");
            var conflicting = new WindowsBluetoothReader.Node { Container = id, Connected = true, Percentage = 80 };
            Check(WindowsBluetoothReader.BuildJson(new[] { conflicting, main, service }) == empty, "ambiguous service values");
            main.Percentage = 75;
            Check(WindowsBluetoothReader.BuildJson(new[] { conflicting, main, service }).Contains("\"percentage\":75"), "main battery takes priority");
        }

        private static void Check(bool condition, string scenario)
        {
            if (!condition) throw new InvalidOperationException("Windows Bluetooth self-test failed: " + scenario);
        }
    }
}
