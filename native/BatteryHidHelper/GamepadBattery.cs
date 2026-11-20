using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using HidSharp;

namespace BatteryFlexBar.Native
{
    internal static class GamepadBattery
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct XInputBattery
        {
            public byte Type;
            public byte Level;
        }

        [DllImport("xinput1_4.dll", ExactSpelling = true)]
        private static extern uint XInputGetBatteryInformation(uint index, byte deviceType, out XInputBattery battery);

        public static string ReadJson(bool xbox)
        {
            if (!xbox) return SystemBatteryJson.Build("gamepad-hid", ScanHid());
            var rows = ScanWindowsGamingInput();
            return SystemBatteryJson.Build("xbox", rows.Count > 0 ? (IEnumerable<SystemBatteryReading>)rows : ScanXbox());
        }

        private static List<SystemBatteryReading> ScanWindowsGamingInput()
        {
            var result = new List<SystemBatteryReading>();
            try
            {
                // Use the Windows inbox WinRT projection; no SDK .winmd or redistributable at runtime.
                Type type = Type.GetType("Windows.Gaming.Input.RawGameController, Windows, ContentType=WindowsRuntime", false);
                if (type == null) return result;
                var controllers = type.GetProperty("RawGameControllers").GetValue(null, null) as IEnumerable;
                if (controllers == null) return result;
                MethodInfo read = type.GetMethod("TryGetBatteryReport");
                if (read == null) return result;
                Type reportType = read.ReturnType;
                PropertyInfo statusProperty = reportType.GetProperty("Status");
                PropertyInfo remainingProperty = reportType.GetProperty("RemainingCapacityInMilliwattHours");
                PropertyInfo fullProperty = reportType.GetProperty("FullChargeCapacityInMilliwattHours");
                if (statusProperty == null || remainingProperty == null || fullProperty == null) return result;
                foreach (object controller in controllers)
                {
                    if (result.Count >= 8) break;
                    try
                    {
                        if (Convert.ToUInt16(type.GetProperty("HardwareVendorId").GetValue(controller, null)) != 0x045E) continue;
                        string hardwareId = type.GetProperty("NonRoamableId").GetValue(controller, null) as string;
                        if (string.IsNullOrEmpty(hardwareId)) continue;
                        object report = read.Invoke(controller, null);
                        if (report == null) continue;
                        string status = Convert.ToString(statusProperty.GetValue(report, null));
                        int? remaining = remainingProperty.GetValue(report, null) as int?;
                        int? full = fullProperty.GetValue(report, null) as int?;
                        int? percent = DecodeCapacity(remaining, full, status);
                        if (!percent.HasValue) continue;
                        Guid id;
                        using (var hash = SHA256.Create())
                            id = new Guid(hash.ComputeHash(Encoding.UTF8.GetBytes(hardwareId)).Take(16).ToArray());
                        if (result.Any(row => row.ContainerId == id)) continue;
                        string name = type.GetProperty("DisplayName").GetValue(controller, null) as string;
                        result.Add(new SystemBatteryReading(id, string.IsNullOrWhiteSpace(name) ? "Xbox gamepad" : name,
                            percent, "unknown", status == "Charging", "gamepad"));
                    }
                    catch (TargetInvocationException) { }
                    catch (COMException) { }
                }
            }
            catch (TypeLoadException) { }
            catch (TargetInvocationException) { }
            catch (COMException) { }
            return result;
        }

        internal static int? DecodeCapacity(int? remaining, int? full, string status)
        {
            if (status != "Charging" && status != "Discharging" && status != "Idle") return null;
            if (!remaining.HasValue || !full.HasValue || full.Value <= 0 || remaining.Value < 0 ||
                remaining.Value > full.Value) return null;
            return (int)((remaining.Value * 100L + full.Value / 2L) / full.Value);
        }

        private static IEnumerable<SystemBatteryReading> ScanXbox()
        {
            var result = new List<SystemBatteryReading>();
            try
            {
                for (uint index = 0; index < 4; index++)
                {
                    XInputBattery battery;
                    if (XInputGetBatteryInformation(index, 0, out battery) != 0) continue;
                    string level = DecodeXbox(battery.Type, battery.Level);
                    if (level == null) continue;
                    // XInput exposes player slots, not the physical controller or connection type.
                    var id = new Guid(0, 0, 0, 0xA1, 0, 0, 0, 0, 0, 0, (byte)(index + 1));
                    result.Add(new SystemBatteryReading(id, "XInput gamepad " + (index + 1), null,
                        "unknown", null, "gamepad", 0, level));
                }
            }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            return result;
        }

        internal static string DecodeXbox(byte type, byte level)
        {
            if (type != 2 && type != 3) return null; // Reject disconnected, wired, and unknown battery types.
            switch (level)
            {
                case 0: return "critical";
                case 1: return "low";
                case 2: return "medium";
                case 3: return "full";
                default: return null;
            }
        }

        internal static bool OwnsDevice(int vid, int pid)
        {
            return (vid == 0x054C && (pid == 0x05C4 || pid == 0x09CC)) || (vid == 0x057E && pid == 0x2009);
        }

        private static IEnumerable<SystemBatteryReading> ScanHid()
        {
            var result = new Dictionary<Guid, SystemBatteryReading>();
            var candidates = DeviceList.Local.GetHidDevices().Where(d => OwnsDevice(d.VendorID, d.ProductID)).ToArray();
            foreach (var reading in candidates.Take(8).AsParallel().WithDegreeOfParallelism(8).Select(ReadHid))
            {
                if (reading != null && !result.ContainsKey(reading.ContainerId)) result.Add(reading.ContainerId, reading);
            }
            return result.Values.OrderBy(row => row.ContainerId);
        }

        private static SystemBatteryReading ReadHid(HidDevice device)
        {
            try
            {
                Guid id;
                if (!UsbHidIdentity.TryGetContainer(device.DevicePath, out id)) return null;
                if (!HidCollection.Matches(device, 0x00010005) && !HidCollection.Matches(device, 0x00010004)) return null;
                bool sony = device.VendorID == 0x054C;
                int length = device.GetMaxInputReportLength();
                if (length < (sony ? 31 : 13) || length > 128) return null;
                if (!device.GetReportDescriptor().InputReports.Any(report => report.ReportID == (sony ? 1 : 0x30))) return null;
                HidStream stream;
                if (!device.TryOpen(out stream)) return null;
                using (stream)
                {
                    var level = VendorHidBattery.ReadPassive(stream, length, 400, (data, count) => DecodeHid(data, count, sony));
                    return level == null ? null : new SystemBatteryReading(id, sony ? "Sony DualShock 4" : "Nintendo Switch Pro Controller",
                        level.Percent, "usb", level.Charging, "gamepad", sony ? 10 : 25);
                }
            }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
            catch (ArgumentException) { return null; }
        }

        internal static VendorHidBattery.Level DecodeHid(byte[] data, int length, bool sony)
        {
            if (sony)
            {
                if (length < 31 || data[0] != 1 || (data[30] & 0x10) == 0) return null;
                int level = data[30] & 0x0F;
                return level > 11 ? null : new VendorHidBattery.Level(Math.Min(level, 10) * 10, level < 11);
            }
            if (length < 13 || data[0] != 0x30) return null;
            int code = (data[2] & 0xE0) >> 5;
            return code > 4 ? null : new VendorHidBattery.Level(code * 25, code < 4 && (data[2] & 0x10) != 0);
        }

        public static void SelfTest()
        {
            var sony = new byte[64]; sony[0] = 1; sony[30] = 0x17;
            Check(DecodeHid(sony, sony.Length, true).Percent == 70 && DecodeHid(sony, sony.Length, true).Charging == true);
            sony[30] = 0x1E; Check(DecodeHid(sony, sony.Length, true) == null);
            sony[30] = 0x1B; Check(DecodeHid(sony, sony.Length, true).Percent == 100 && DecodeHid(sony, 30, true) == null);
            var nintendo = new byte[13]; nintendo[0] = 0x30; nintendo[2] = 0x70;
            Check(DecodeHid(nintendo, nintendo.Length, false).Percent == 75 && DecodeHid(nintendo, nintendo.Length, false).Charging == true);
            nintendo[0] = 0x3F; Check(DecodeHid(nintendo, nintendo.Length, false) == null);
            Check(DecodeXbox(2, 0) == "critical" && DecodeXbox(3, 3) == "full" && DecodeXbox(1, 3) == null && DecodeXbox(2, 4) == null);
            Check(DecodeCapacity(470, 600, "Charging") == 78 && DecodeCapacity(0, 600, "Discharging") == 0 &&
                DecodeCapacity(600, 600, "NotPresent") == null && DecodeCapacity(601, 600, "Idle") == null);
        }

        private static void Check(bool condition)
        {
            if (!condition) throw new InvalidDataException("Gamepad battery self-test failed.");
        }
    }
}
