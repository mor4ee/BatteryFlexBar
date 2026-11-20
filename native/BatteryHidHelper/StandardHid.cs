using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using HidSharp;
using HidSharp.Reports;

namespace BatteryFlexBar.Native
{
    internal static class StandardHidReader
    {
        // Generic Device Controls / Battery Strength, HID Usage Tables §9.2.
        private const uint BatteryStrength = 0x00060020;
        private const int ScanBudgetMs = 1200;
        private const int InputBudgetMs = 120;
        private const int MaxReportLength = 1024;

        private sealed class Collection
        {
            public HidDevice Device;
            public Guid ContainerId;
            public ReportDescriptor Descriptor;
        }

        public static string ReadJson()
        {
            return SystemBatteryJson.Build("standard-hid", Scan());
        }

        private static IEnumerable<SystemBatteryReading> Scan()
        {
            var elapsed = Stopwatch.StartNew();
            var collections = new List<Collection>();
            foreach (HidDevice device in DeviceList.Local.GetHidDevices())
            {
                if (elapsed.ElapsedMilliseconds >= ScanBudgetMs) yield break;
                try
                {
                    Guid containerId;
                    if (!UsbHidIdentity.TryGetContainer(device.DevicePath, out containerId)) continue;
                    collections.Add(new Collection { Device = device, ContainerId = containerId,
                        Descriptor = TryReadDescriptor(device) });
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }

            // Inspect sibling collections before requesting any report. One
            // physical device can expose separate digitizer and battery collections.
            foreach (var group in collections.GroupBy(item => item.ContainerId).OrderBy(group => group.Key))
            {
                if (elapsed.ElapsedMilliseconds >= ScanBudgetMs) yield break;
                if (group.Any(IsExcluded)) continue;
                var readings = new List<SystemBatteryReading>();
                foreach (Collection collection in group)
                {
                    if (elapsed.ElapsedMilliseconds >= ScanBudgetMs) break;
                    SystemBatteryReading reading = ReadCollection(collection, elapsed);
                    if (reading != null) readings.Add(reading);
                }
                if (readings.Count > 0 && readings.All(reading => reading.Percentage == readings[0].Percentage))
                {
                    yield return readings[0];
                }
            }
        }

        private static ReportDescriptor TryReadDescriptor(HidDevice device)
        {
            try { return device.GetReportDescriptor(); }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
            catch (ArgumentException) { return null; }
            catch (InvalidOperationException) { return null; }
            catch (NotSupportedException) { return null; }
        }

        private static bool IsExcluded(Collection collection)
        {
            int vid = collection.Device.VendorID;
            int pid = collection.Device.ProductID;
            // Existing Battery adapters own these routes on every poll, even
            // when the device behind a receiver is temporarily unavailable.
            if ((vid == 0x046D && (pid == 0xC548 || pid == 0xC53F || pid == 0xC539)) ||
                (vid == 0x3434 && KeychronReceiver.Handles(pid)) ||
                LamzuAuroraReader.Handles(vid, pid) ||
                (vid == 0x054C && (pid == 0x0CE6 || pid == 0x0DF2)) ||
                GamepadBattery.OwnsDevice(vid, pid) ||
                VendorHidBattery.OwnsCollection(collection.Device) ||
                CommonHidBattery.OwnsCollection(collection.Device, collection.Descriptor)) return true;
            return collection.Descriptor != null &&
                collection.Descriptor.DeviceItems.Any(item => item.Usages.GetAllValues().Any(IsExcludedUsage));
        }

        internal static bool IsExcludedUsage(uint usage)
        {
            uint page = usage >> 16;
            return page == 0x0D || page == 0x84 || page == 0x85; // Digitizer, power device, battery system.
        }

        private static SystemBatteryReading ReadCollection(Collection collection, Stopwatch elapsed)
        {
            if (collection.Descriptor == null) return null;
            var features = collection.Descriptor.FeatureReports.Where(IsBatteryReport).ToArray();
            var inputs = collection.Descriptor.InputReports.Where(IsBatteryReport).ToDictionary(report => report.ReportID);
            if (features.Length == 0 && inputs.Count == 0) return null;

            int? percent;
            try
            {
                HidStream stream;
                if (!collection.Device.TryOpen(out stream)) return null;
                using (stream)
                {
                    percent = ReadFeature(collection.Device, stream, features, elapsed) ??
                        ReadInput(collection.Device, stream, inputs, elapsed);
                }
            }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
            catch (TimeoutException) { return null; }
            if (!percent.HasValue) return null;

            string name = "USB HID device";
            try
            {
                string product = collection.Device.GetFriendlyName();
                if (!string.IsNullOrWhiteSpace(product)) name = product.Trim();
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            return new SystemBatteryReading(collection.ContainerId, name, percent.Value);
        }

        private static int? ReadFeature(HidDevice device, HidStream stream, Report[] reports, Stopwatch elapsed)
        {
            if (reports.Length == 0) return null;
            int length = device.GetMaxFeatureReportLength();
            if (length < 2 || length > MaxReportLength) return null;
            foreach (Report report in reports)
            {
                if (elapsed.ElapsedMilliseconds >= ScanBudgetMs) break;
                var buffer = new byte[length];
                buffer[0] = report.ReportID;
                try { stream.GetFeature(buffer); }
                catch (IOException) { continue; }
                catch (TimeoutException) { continue; }
                int? percent = Decode(report, buffer, buffer.Length);
                if (percent.HasValue) return percent;
            }
            return null;
        }

        private static int? ReadInput(HidDevice device, HidStream stream, Dictionary<byte, Report> reports, Stopwatch elapsed)
        {
            if (reports.Count == 0) return null;
            int length = device.GetMaxInputReportLength();
            if (length < 2 || length > MaxReportLength) return null;
            var buffer = new byte[length];
            long deadline = Math.Min(ScanBudgetMs, elapsed.ElapsedMilliseconds + InputBudgetMs);
            while (elapsed.ElapsedMilliseconds < deadline)
            {
                stream.ReadTimeout = (int)Math.Max(1, deadline - elapsed.ElapsedMilliseconds);
                int count = stream.Read(buffer);
                Report report;
                if (count < 2 || !reports.TryGetValue(buffer[0], out report)) continue;
                int? percent = Decode(report, buffer, count);
                if (percent.HasValue) return percent;
            }
            return null;
        }

        internal static bool IsBatteryReport(Report report)
        {
            return report.ReportType != ReportType.Output &&
                report.DataItems.Any(item => IsBatteryValue(item) && item.Usages.ContainsValue(BatteryStrength));
        }

        private static bool IsBatteryValue(DataItem item)
        {
            return !item.IsConstant && item.IsVariable && item.IsAbsolute &&
                item.ElementBits > 0 && item.ElementBits <= 16 &&
                item.LogicalMinimum >= 0 && item.LogicalMaximum > item.LogicalMinimum;
        }

        internal static int? Decode(Report report, byte[] buffer, int count)
        {
            if (count < report.Length || count > buffer.Length || count < 2 || buffer[0] != report.ReportID) return null;
            var values = new HashSet<int>();
            report.Read(buffer, 0, value =>
            {
                DataItem item = value.DataItem;
                if (!IsBatteryValue(item) || !value.Usages.Contains(BatteryStrength) || !value.IsValid || value.IsNull) return;
                int raw = value.GetLogicalValue();
                if (raw < item.LogicalMinimum || raw > item.LogicalMaximum) return;
                double fraction = (double)(raw - item.LogicalMinimum) / (item.LogicalMaximum - item.LogicalMinimum);
                values.Add((int)Math.Round(fraction * 100, MidpointRounding.AwayFromZero));
            });
            return values.Count == 1 ? (int?)values.First() : null;
        }
    }

    internal static class UsbHidIdentity
    {
        private const uint StringProperty = 0x12;
        private const uint GuidProperty = 0x0D;
        private static readonly Guid SystemContainer = new Guid("00000000-0000-0000-FFFF-FFFFFFFFFFFF");

        public static bool TryGetContainer(string path, out Guid containerId)
        {
            containerId = Guid.Empty;
            if (string.IsNullOrEmpty(path)) return false;
            var instanceKey = new PropertyKey("78C34FC8-104A-4ACA-9EA4-524D52996E57", 256);
            var instance = new byte[1024];
            uint length = (uint)instance.Length, type, node, parent;
            if (CM_Get_Device_Interface_PropertyW(path, ref instanceKey, out type, instance, ref length, 0) != 0 ||
                type != StringProperty || length < 2 || length > instance.Length || length % 2 != 0 ||
                CM_Locate_DevNodeW(out node, Encoding.Unicode.GetString(instance, 0, (int)length).TrimEnd('\0'), 0) != 0 ||
                CM_Get_Parent(out parent, node, 0) != 0) return false;

            // HID paths alone can look similar for USB and Bluetooth. Require
            // the actual USB parent device, rather than the Bluetooth radio's USB ancestor.
            var parentId = new StringBuilder(512);
            if (CM_Get_Device_IDW(parent, parentId, parentId.Capacity, 0) != 0 ||
                !parentId.ToString().StartsWith("USB\\VID_", StringComparison.OrdinalIgnoreCase)) return false;

            var containerKey = new PropertyKey("8C7ED206-3F8A-4827-B3AB-AE9E1FAEFC6C", 2);
            var value = new byte[16];
            length = (uint)value.Length;
            if (CM_Get_DevNode_PropertyW(parent, ref containerKey, out type, value, ref length, 0) != 0 ||
                type != GuidProperty || length != value.Length) return false;
            containerId = new Guid(value);
            return containerId != Guid.Empty && containerId != SystemContainer;
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

        [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint CM_Get_Device_Interface_PropertyW(string path, ref PropertyKey key, out uint type,
            [Out] byte[] value, ref uint length, uint flags);

        [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint CM_Locate_DevNodeW(out uint node, string id, uint flags);

        [DllImport("cfgmgr32.dll", ExactSpelling = true)]
        private static extern uint CM_Get_Parent(out uint parent, uint node, uint flags);

        [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
        private static extern uint CM_Get_Device_IDW(uint node, StringBuilder id, int length, uint flags);

        [DllImport("cfgmgr32.dll", ExactSpelling = true)]
        private static extern uint CM_Get_DevNode_PropertyW(uint node, ref PropertyKey key, out uint type,
            [Out] byte[] value, ref uint length, uint flags);
    }

    internal static class StandardHidSelfTest
    {
        public static void Run()
        {
            var descriptor = new ReportDescriptor(new byte[] {
                0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, // Keyboard application.
                0x85, 0x07, 0x05, 0x06, 0x09, 0x20, // ID 7, Battery Strength.
                0x15, 0x00, 0x25, 0x0A, 0x75, 0x08, 0x95, 0x01, 0xB1, 0x42,
                0x85, 0x08, 0x09, 0x20, 0x81, 0x42, // Same usage in input report 8.
                0x85, 0x09, 0x09, 0x20, 0x91, 0x02, // Exclude output.
                0x85, 0x0A, 0x09, 0x21, 0xB1, 0x02, // Exclude Wireless Channel.
                0xC0
            });
            Report feature = descriptor.FeatureReports.First(report => report.ReportID == 7);
            Report input = descriptor.InputReports.Single();
            Check(StandardHidReader.IsBatteryReport(feature) && StandardHidReader.IsBatteryReport(input), "battery report discovery");
            Check(!StandardHidReader.IsBatteryReport(descriptor.OutputReports.Single()) &&
                !StandardHidReader.IsBatteryReport(descriptor.FeatureReports.Single(report => report.ReportID == 10)), "unrelated report types");
            Check(StandardHidReader.Decode(feature, new byte[] { 7, 0 }, 2) == 0 &&
                StandardHidReader.Decode(feature, new byte[] { 7, 7 }, 2) == 70 &&
                StandardHidReader.Decode(input, new byte[] { 8, 10 }, 2) == 100, "declared range including zero");
            Check(StandardHidReader.Decode(feature, new byte[] { 7, 0xFF }, 2) == null &&
                StandardHidReader.Decode(feature, new byte[] { 8, 7 }, 2) == null &&
                StandardHidReader.Decode(feature, new byte[] { 7, 7 }, 1) == null, "null, wrong ID and truncated report");
            Check(StandardHidReader.IsExcludedUsage(0x000D0001) &&
                StandardHidReader.IsExcludedUsage(0x00840004) &&
                !StandardHidReader.IsExcludedUsage(0x00010006), "excluded collection pages");
        }

        private static void Check(bool condition, string scenario)
        {
            if (!condition) throw new InvalidOperationException("Standard HID self-test failed: " + scenario);
        }
    }
}
