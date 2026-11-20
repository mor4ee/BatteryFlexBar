using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using HidSharp;

namespace BatteryFlexBar.Native
{
    internal sealed class DualSenseBatteryInformation
    {
        public int? Percentage;
        public string Status = "unknown";
        public bool Charging;
        public int ReportId;
        public int ReportLength;
        public int StatusByte;
        public string Diagnostic;
    }

    internal sealed class DualSenseDeviceInformation
    {
        public int ProductId;
        public string UnitId;
        public string Transport;
        public string Availability = "error";
        public string Diagnostic;
        public DualSenseBatteryInformation Battery = new DualSenseBatteryInformation();

        public string Model
        {
            get { return ProductId == 0x0DF2 ? "dualsense-edge" : "dualsense"; }
        }

        public string Name
        {
            get { return ProductId == 0x0DF2 ? "DualSense Edge" : "DualSense"; }
        }
    }

    internal static class DualSenseIdentity
    {
        public static string NormalizeMac(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) { return null; }
            string compact = value.Trim().Replace(":", "").Replace("-", "");
            if (compact.Length != 12 || !compact.All(IsHex) ||
                compact == "000000000000" ||
                string.Equals(compact, "ffffffffffff", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
            return compact.ToLowerInvariant();
        }

        public static string NormalizeUnitId(string value)
        {
            string mac = NormalizeMac(value);
            if (mac != null) { return mac; }
            if (value != null && value.Length == 69 &&
                value.StartsWith("path-", StringComparison.OrdinalIgnoreCase) &&
                value.Substring(5).All(IsHex))
            {
                return value.ToLowerInvariant();
            }
            return null;
        }

        public static string FromPath(string path)
        {
            using (SHA256 hash = SHA256.Create())
            {
                byte[] bytes = hash.ComputeHash(Encoding.UTF8.GetBytes(
                    (path ?? string.Empty).ToLowerInvariant()));
                return "path-" + Hex.Compact(bytes, 0, bytes.Length);
            }
        }

        public static string FromFeature(byte[] feature)
        {
            if (feature == null || feature.Length < 20 || feature[0] != 0x09)
            {
                return null;
            }
            StringBuilder serial = new StringBuilder(12);
            for (int index = 6; index >= 1; index--)
            {
                serial.Append(feature[index].ToString("x2", CultureInfo.InvariantCulture));
            }
            return NormalizeMac(serial.ToString());
        }

        private static bool IsHex(char value)
        {
            return (value >= '0' && value <= '9') ||
                (value >= 'a' && value <= 'f') ||
                (value >= 'A' && value <= 'F');
        }
    }

    internal static class DualSenseProtocol
    {
        public const int VendorId = 0x054C;
        public const int DualSenseProductId = 0x0CE6;
        public const int EdgeProductId = 0x0DF2;

        public static bool IsSupportedProduct(int productId)
        {
            return productId == DualSenseProductId || productId == EdgeProductId;
        }

        public static string TransportForInputLength(int maximumInputReportLength)
        {
            // Windows pads simple Bluetooth report 0x01 to 78 bytes. Its report
            // ID alone therefore cannot establish USB transport or battery data.
            if (maximumInputReportLength == 64) { return "usb"; }
            if (maximumInputReportLength == 78) { return "bluetooth"; }
            return null;
        }

        public static bool IsBluetoothSimpleReport(byte[] report, string transport)
        {
            return transport == "bluetooth" && report != null &&
                (report.Length == 10 || report.Length == 78) && report[0] == 0x01;
        }

        public static bool ShouldEnableBluetooth(
            string transport, string unitId, byte[] report, ISet<string> permittedDevices)
        {
            return IsBluetoothSimpleReport(report, transport) &&
                permittedDevices != null && permittedDevices.Contains(unitId);
        }

        public static bool TryParseBattery(
            byte[] report,
            string transport,
            out DualSenseBatteryInformation battery,
            out string diagnostic)
        {
            battery = null;
            diagnostic = "unsupported-input-report";
            if (report == null || report.Length == 0) { return false; }
            int offset;
            if (transport == "usb")
            {
                if (report[0] != 0x01 || report.Length != 64)
                {
                    diagnostic = "invalid-usb-report";
                    return false;
                }
                offset = 53;
            }
            else if (transport == "bluetooth")
            {
                if (IsBluetoothSimpleReport(report, transport))
                {
                    diagnostic = "bluetooth-simple-mode";
                    return false;
                }
                if (report[0] != 0x31 || report.Length != 78)
                {
                    diagnostic = "invalid-bluetooth-report";
                    return false;
                }
                if (!HasValidBluetoothCrc(report))
                {
                    diagnostic = "bluetooth-crc-mismatch";
                    return false;
                }
                offset = 54;
            }
            else { return false; }

            int statusByte = report[offset];
            int level = statusByte & 0x0F;
            int status = statusByte >> 4;
            battery = new DualSenseBatteryInformation
            {
                ReportId = report[0],
                ReportLength = report.Length,
                StatusByte = statusByte
            };
            diagnostic = null;
            if (status == 2)
            {
                // Charge-complete is authoritative even when its level nibble
                // isn't a normal 0..10 reading (same policy as Sony's driver).
                battery.Percentage = 100;
                battery.Status = "full";
            }
            else if ((status == 0 || status == 1) && level <= 10)
            {
                // Firmware reports a ten-percent band, not an exact percentage.
                // Match Linux hid-playstation and SDL's midpoint convention.
                battery.Percentage = Math.Min(level * 10 + 5, 100);
                battery.Charging = status == 1;
                battery.Status = battery.Charging ? "charging" : "discharging";
            }
            else
            {
                battery.Status = status == 0xA || status == 0xB || status == 0xF
                    ? "error" : "unknown";
                if (status == 0xA) { diagnostic = "battery-voltage-error"; }
                else if (status == 0xB) { diagnostic = "battery-temperature-error"; }
                else if (status == 0xF) { diagnostic = "battery-charging-error"; }
                else if (status == 0 || status == 1) { diagnostic = "invalid-battery-level"; }
                else { diagnostic = "unknown-battery-status"; }
                battery.Diagnostic = diagnostic;
            }
            return true;
        }

        public static bool HasValidBluetoothCrc(byte[] report)
        {
            if (report == null || report.Length != 78) { return false; }
            uint actual = (uint)report[74] | ((uint)report[75] << 8) |
                ((uint)report[76] << 16) | ((uint)report[77] << 24);
            return actual == BluetoothCrc(report);
        }

        internal static uint BluetoothCrc(byte[] report)
        {
            uint crc = UpdateCrc(0xFFFFFFFF, 0xA1);
            for (int index = 0; index < 74; index++)
            {
                crc = UpdateCrc(crc, report[index]);
            }
            return ~crc;
        }

        private static uint UpdateCrc(uint crc, byte value)
        {
            crc ^= value;
            for (int bit = 0; bit < 8; bit++)
            {
                crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320 : crc >> 1;
            }
            return crc;
        }
    }

    internal static class DualSenseReader
    {
        private const int MaximumScanMilliseconds = 4000;

        public static List<DualSenseDeviceInformation> ReadAll(
            int timeoutMilliseconds, int attempts, ISet<string> permittedBluetoothDevices)
        {
            Stopwatch scanTimer = Stopwatch.StartNew();
            List<DualSenseDeviceInformation> results = new List<DualSenseDeviceInformation>();
            HashSet<string> paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (HidDevice device in DeviceList.Local.GetHidDevices(DualSenseProtocol.VendorId)
                .Where(candidate => DualSenseProtocol.IsSupportedProduct(candidate.ProductID)))
            {
                if (!paths.Add(device.DevicePath ?? string.Empty)) { continue; }
                string transport;
                try { transport = DualSenseProtocol.TransportForInputLength(device.GetMaxInputReportLength()); }
                catch { continue; }
                // Ignore other HID collections, not arbitrary Sony controllers.
                if (transport == null) { continue; }
                DualSenseDeviceInformation result = new DualSenseDeviceInformation
                {
                    ProductId = device.ProductID,
                    UnitId = DualSenseIdentity.FromPath(device.DevicePath),
                    Transport = transport
                };
                try
                {
                    string serial = DualSenseIdentity.NormalizeMac(device.GetSerialNumber());
                    if (serial != null) { result.UnitId = serial; }
                }
                catch
                {
                    // A path hash is a private-path-free fallback, stable while
                    // the same Windows HID instance remains paired/connected.
                }
                int remaining = MaximumScanMilliseconds - (int)scanTimer.ElapsedMilliseconds;
                if (remaining <= 0)
                {
                    result.Diagnostic = "scan-timeout";
                    results.Add(result);
                    continue;
                }
                try
                {
                    ReadDevice(device, result,
                        Math.Min(remaining, Math.Min(2000, timeoutMilliseconds * attempts)),
                        permittedBluetoothDevices);
                }
                catch (UnauthorizedAccessException)
                {
                    result.Diagnostic = "device-access-denied";
                }
                catch (TimeoutException)
                {
                    result.Diagnostic = "device-read-timeout";
                }
                catch
                {
                    // Driver exceptions can contain the full HID path. Return
                    // only a stable diagnostic and isolate this device failure.
                    result.Diagnostic = "device-read-error";
                }
                results.Add(result);
            }
            // If USB and Bluetooth interfaces coexist for one physical pad,
            // prefer a valid reading and then USB (including its charging state).
            return results.GroupBy(result => result.Model + ":" + result.UnitId)
                .Select(group => group.OrderBy(result => result.Availability == "online" ? 0 : 1)
                    .ThenBy(result => result.Transport == "usb" ? 0 : 1).First())
                .ToList();
        }

        private static void ReadDevice(
            HidDevice device,
            DualSenseDeviceInformation result,
            int budgetMilliseconds,
            ISet<string> permittedBluetoothDevices)
        {
            Stopwatch timer = Stopwatch.StartNew();
            // Open() is shared/nonexclusive. Do not write output reports, change
            // LEDs/rumble, SetFeature, or read calibration/firmware reports.
            using (HidStream stream = device.Open())
            {
                if (result.Transport == "usb" && result.UnitId.StartsWith("path-"))
                {
                    try
                    {
                        string serial = DualSenseIdentity.FromFeature(ReadSerialFeature(stream));
                        if (serial != null) { result.UnitId = serial; }
                    }
                    catch
                    {
                        // USB telemetry does not depend on feature 0x09.
                    }
                }
                bool enabled = false;
                string diagnostic = "no-battery-report";
                while (timer.ElapsedMilliseconds < budgetMilliseconds)
                {
                    stream.ReadTimeout = Math.Max(1, Math.Min(50,
                        budgetMilliseconds - (int)timer.ElapsedMilliseconds));
                    byte[] report;
                    try { report = stream.Read(); }
                    catch (TimeoutException) { continue; }
                    DualSenseBatteryInformation battery;
                    if (DualSenseProtocol.TryParseBattery(report, result.Transport,
                        out battery, out diagnostic))
                    {
                        result.Battery = battery;
                        result.Availability = battery.Percentage.HasValue ? "online" : "error";
                        result.Diagnostic = diagnostic;
                        return;
                    }
                    if (!enabled && DualSenseProtocol.ShouldEnableBluetooth(
                        result.Transport, result.UnitId, report, permittedBluetoothDevices))
                    {
                        // GET 0x09 enables enhanced Bluetooth input and can break
                        // legacy DirectInput until a power cycle. It is performed
                        // ONLY for an explicitly permitted controller in simple
                        // mode, never as part of passive discovery.
                        ReadSerialFeature(stream);
                        enabled = true;
                    }
                }
                result.Diagnostic = diagnostic;
                result.Availability = diagnostic == "bluetooth-simple-mode"
                    ? "unsupported" : "error";
            }
        }

        private static byte[] ReadSerialFeature(HidStream stream)
        {
            byte[] feature = new byte[20];
            feature[0] = 0x09;
            stream.GetFeature(feature);
            return feature;
        }
    }

    internal static class DualSenseJsonResult
    {
        public static string Build(IEnumerable<DualSenseDeviceInformation> devices)
        {
            StringBuilder json = new StringBuilder("{\"source\":\"sony-dualsense-hid\",\"devices\":[");
            bool first = true;
            foreach (DualSenseDeviceInformation device in devices)
            {
                if (!first) { json.Append(','); }
                first = false;
                json.Append('{');
                String(json, "productId", "0x" + device.ProductId.ToString("X4", CultureInfo.InvariantCulture));
                json.Append(',');
                String(json, "unitId", device.UnitId);
                json.Append(',');
                String(json, "name", device.Name);
                json.Append(',');
                String(json, "model", device.Model);
                json.Append(',');
                String(json, "transport", device.Transport);
                json.Append(',');
                String(json, "availability", device.Availability);
                json.Append(",\"battery\":{\"percentage\":");
                json.Append(device.Battery.Percentage.HasValue
                    ? device.Battery.Percentage.Value.ToString(CultureInfo.InvariantCulture) : "null");
                json.Append(',');
                String(json, "status", device.Battery.Status);
                json.Append(",\"charging\":").Append(device.Battery.Charging ? "true" : "false").Append('}');
                if (device.Diagnostic != null)
                {
                    json.Append(',');
                    String(json, "diagnostic", device.Diagnostic);
                }
                if (device.Battery.ReportLength > 0)
                {
                    json.Append(",\"protocol\":{\"reportId\":").Append(device.Battery.ReportId)
                        .Append(",\"reportLength\":").Append(device.Battery.ReportLength)
                        .Append(",\"statusByte\":").Append(device.Battery.StatusByte).Append('}');
                }
                json.Append('}');
            }
            return json.Append("]}").ToString();
        }

        private static void String(StringBuilder json, string key, string value)
        {
            // All fields originate from fixed protocol labels or normalized IDs.
            json.Append('"').Append(key).Append("\":\"")
                .Append(value.Replace("\\", "\\\\").Replace("\"", "\\\"")).Append('"');
        }
    }

    internal static class DualSenseSelfTest
    {
        public static void Run()
        {
            string diagnostic;
            DualSenseBatteryInformation battery;
            foreach (int productId in new[] { 0x0CE6, 0x0DF2 })
            {
                Check(DualSenseProtocol.IsSupportedProduct(productId), "official product");
                DualSenseDeviceInformation device = new DualSenseDeviceInformation { ProductId = productId };
                Check(device.Model == (productId == 0x0CE6 ? "dualsense" : "dualsense-edge"), "model identity");
                Check(device.Name == (productId == 0x0CE6 ? "DualSense" : "DualSense Edge"), "model name");
            }
            Check(!DualSenseProtocol.IsSupportedProduct(0x05C4), "reject DualShock 4");
            Check(DualSenseProtocol.TransportForInputLength(64) == "usb", "USB capability");
            Check(DualSenseProtocol.TransportForInputLength(78) == "bluetooth", "Bluetooth capability");
            Check(DualSenseProtocol.TransportForInputLength(10) == null, "ignore other HID collection");

            foreach (string transport in new[] { "usb", "bluetooth" })
            {
                foreach (int level in Enumerable.Range(0, 11))
                {
                    foreach (int status in new[] { 0, 1 })
                    {
                        Check(DualSenseProtocol.TryParseBattery(Report(transport, (status << 4) | level),
                            transport, out battery, out diagnostic), "valid battery report");
                        Check(battery.Percentage == Math.Min(level * 10 + 5, 100), "ten-percent midpoint");
                        Check(battery.Charging == (status == 1), "charging status");
                        Check(battery.Status == (status == 1 ? "charging" : "discharging"), "status label");
                    }
                }
                Check(DualSenseProtocol.TryParseBattery(Report(transport, 0x2F), transport,
                    out battery, out diagnostic) && battery.Percentage == 100 &&
                    !battery.Charging && battery.Status == "full", "full override");
                foreach (int error in new[] { 0xA5, 0xB5, 0xF5, 0x35, 0x0F, 0x1B })
                {
                    Check(DualSenseProtocol.TryParseBattery(Report(transport, error), transport,
                        out battery, out diagnostic) && !battery.Percentage.HasValue &&
                        !battery.Charging && diagnostic != null, "unknown battery is not zero");
                }
                byte[] full = Report(transport, 0x05);
                Check(!DualSenseProtocol.TryParseBattery(full.Take(full.Length - 1).ToArray(),
                    transport, out battery, out diagnostic), "truncated report");
                full[0] = 0x02;
                Check(!DualSenseProtocol.TryParseBattery(full, transport,
                    out battery, out diagnostic), "unknown report ID");
            }

            byte[] paddedSimple = new byte[78];
            paddedSimple[0] = 0x01;
            Check(!DualSenseProtocol.TryParseBattery(paddedSimple, "bluetooth", out battery, out diagnostic) &&
                diagnostic == "bluetooth-simple-mode", "padded Bluetooth simple report has no battery");
            Check(!DualSenseProtocol.TryParseBattery(paddedSimple, "usb", out battery, out diagnostic),
                "never infer USB from report 01");
            byte[] compactSimple = new byte[10];
            compactSimple[0] = 0x01;
            Check(!DualSenseProtocol.TryParseBattery(compactSimple, "bluetooth", out battery, out diagnostic),
                "compact Bluetooth simple report has no battery");
            byte[] corrupt = Report("bluetooth", 0x05);
            corrupt[54] ^= 1;
            Check(!DualSenseProtocol.TryParseBattery(corrupt, "bluetooth", out battery, out diagnostic) &&
                diagnostic == "bluetooth-crc-mismatch", "corrupt Bluetooth report");
            Check(!DualSenseProtocol.TryParseBattery(null, "usb", out battery, out diagnostic), "null report");
            Check(!DualSenseProtocol.TryParseBattery(new byte[0], "bluetooth", out battery, out diagnostic), "empty report");
            // Fixed CRC obtained independently with standard seeded zlib CRC32.
            byte[] crcVector = new byte[78];
            crcVector[0] = 0x31;
            crcVector[54] = 0x08;
            Check(DualSenseProtocol.BluetoothCrc(crcVector) == 0x8147872F, "independent Bluetooth CRC vector");

            const string unitId = "0123456789ab";
            Check(DualSenseIdentity.NormalizeMac("01:23:45:67:89:AB") == unitId, "serial normalization");
            Check(DualSenseIdentity.NormalizeMac("0123456789AB") == unitId, "Windows Bluetooth serial");
            Check(DualSenseIdentity.NormalizeMac("000000000000") == null, "missing serial");
            Check(DualSenseIdentity.NormalizeMac("ffffffffffff") == null, "invalid serial");
            Check(DualSenseIdentity.NormalizeMac("0123456789zz") == null, "nonhex serial");
            byte[] feature = new byte[20];
            feature[0] = 0x09;
            feature[1] = 0xAB; feature[2] = 0x89; feature[3] = 0x67;
            feature[4] = 0x45; feature[5] = 0x23; feature[6] = 0x01;
            Check(DualSenseIdentity.FromFeature(feature) == unitId, "USB feature MAC byte order");
            Check(DualSenseIdentity.FromFeature(feature.Take(7).ToArray()) == null, "short serial feature");
            string fallback = DualSenseIdentity.FromPath("TEST-PATH");
            Check(fallback.Length == 69 && fallback == DualSenseIdentity.FromPath("test-path") &&
                DualSenseIdentity.NormalizeUnitId(fallback) == fallback, "stable private path hash");
            Check(DualSenseIdentity.NormalizeUnitId("path-bad") == null, "invalid path identifier");

            HashSet<string> none = new HashSet<string>();
            HashSet<string> allowed = new HashSet<string> { unitId };
            Check(!DualSenseProtocol.ShouldEnableBluetooth("bluetooth", unitId, paddedSimple, none),
                "passive scan cannot enable Bluetooth");
            Check(!DualSenseProtocol.ShouldEnableBluetooth("bluetooth", unitId, new byte[] { 0x01 }, allowed),
                "truncated input cannot enable Bluetooth");
            Check(!DualSenseProtocol.ShouldEnableBluetooth("bluetooth", "ab8967452301", paddedSimple, allowed),
                "permission only applies to selected device");
            Check(!DualSenseProtocol.ShouldEnableBluetooth("usb", unitId, Report("usb", 0x05), allowed),
                "USB is never Bluetooth opt-in");
            Check(!DualSenseProtocol.ShouldEnableBluetooth("bluetooth", unitId, Report("bluetooth", 0x05), allowed),
                "no feature request when Bluetooth is already enhanced");
            Check(DualSenseProtocol.ShouldEnableBluetooth("bluetooth", unitId, paddedSimple, allowed),
                "explicit per-device simple-mode opt-in");
            Options defaults = Options.Parse(new[] { "--dualsense" });
            Check(defaults.EnableBluetoothDevices.Count == 0, "CLI passive default");
            Options enabled = Options.Parse(new[] { "--dualsense", "--enable-bt-device", unitId,
                "--enable-bt-device", fallback });
            Check(enabled.EnableBluetoothDevices.Count == 2, "repeatable device opt-in");
            Check(DualSenseJsonResult.Build(new DualSenseDeviceInformation[0]) ==
                "{\"source\":\"sony-dualsense-hid\",\"devices\":[]}", "empty scan output");
            string unknownJson = DualSenseJsonResult.Build(new[] { new DualSenseDeviceInformation
            {
                ProductId = 0x0DF2, UnitId = unitId, Transport = "bluetooth",
                Availability = "unsupported", Diagnostic = "bluetooth-simple-mode"
            } });
            Check(unknownJson.Contains("\"percentage\":null") &&
                unknownJson.Contains("\"charging\":false") &&
                unknownJson.Contains("\"productId\":\"0x0DF2\"") &&
                !unknownJson.Contains("rawResponse"), "unknown JSON preserves absence and privacy");
        }

        private static byte[] Report(string transport, int status)
        {
            byte[] report = new byte[transport == "usb" ? 64 : 78];
            report[0] = transport == "usb" ? (byte)0x01 : (byte)0x31;
            report[transport == "usb" ? 53 : 54] = (byte)status;
            if (transport == "bluetooth")
            {
                uint crc = DualSenseProtocol.BluetoothCrc(report);
                for (int index = 0; index < 4; index++)
                {
                    report[74 + index] = (byte)(crc >> (8 * index));
                }
            }
            return report;
        }

        private static void Check(bool condition, string label)
        {
            if (!condition)
            {
                throw new InvalidDataException("DualSense self-test failed: " + label + ".");
            }
        }
    }
}
