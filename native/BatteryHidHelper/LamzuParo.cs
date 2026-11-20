using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using HidSharp;

namespace BatteryFlexBar.Native
{
    internal sealed class LamzuParoBatteryInformation
    {
        public int Percentage;
        public bool Charging;
        public int ProductId;
    }

    internal static class LamzuParoProtocol
    {
        private const int VendorId = 0x37B0;
        private static readonly int[] ProductIds = { 0x0007, 0x000D };
        private const int ReportLength = 65;

        public static LamzuParoBatteryInformation ReadBattery(int attempts)
        {
            // USB takes priority when both the cable and sleeping 2.4 GHz receiver are present.
            foreach (int productId in ProductIds)
            {
                // Select only the vendor feature interface, never mouse input collections.
                HidDevice device = DeviceList.Local.GetHidDevices(VendorId, productId)
                    .FirstOrDefault(candidate =>
                        (candidate.DevicePath ?? string.Empty).IndexOf(
                            "&MI_02#", StringComparison.OrdinalIgnoreCase) >= 0 &&
                        candidate.GetMaxFeatureReportLength() == ReportLength);
                if (device == null) { continue; }
                var battery = ReadDevice(device, attempts, false, productId != 0x0007);
                if (battery != null) return battery;
            }
            throw new DeviceNotFoundException("Lamzu Paro is absent, switched off, or did not return battery data.");
        }

        internal static LamzuParoBatteryInformation ReadDevice(HidDevice device, int attempts, bool beta, bool receiver)
        {
            try
            {
                HidStream stream;
                if (!device.TryOpen(out stream)) return null;
                using (stream)
                {
                    for (int attempt = 0; attempt < attempts; attempt++)
                    {
                        var request = new byte[ReportLength];
                        request[3] = request[4] = 0x02;
                        request[6] = 0x83;
                        stream.SetFeature(request);
                        Thread.Sleep(100);
                        var response = new byte[ReportLength];
                        stream.GetFeature(response);
                        LamzuParoBatteryInformation battery;
                        bool valid = beta
                            ? TryParseAuroraBattery(response, receiver, out battery)
                            : TryParseBattery(response, out battery);
                        if (valid)
                        {
                            battery.ProductId = device.ProductID;
                            return battery;
                        }
                        if (IsOffline(response)) break;
                    }
                }
            }
            catch (IOException) { }
            catch (TimeoutException) { }
            catch (UnauthorizedAccessException) { }
            return null;
        }

        internal static bool TryParseAuroraBattery(byte[] response, bool receiver, out LamzuParoBatteryInformation battery)
        {
            battery = null;
            if (response == null || response.Length < 8) return false;
            if (response[0] == 0xA1)
            {
                var padded = new byte[9];
                Buffer.BlockCopy(response, 0, padded, 1, 8);
                response = padded;
            }
            if (response.Length < 9 || response[4] != 2 ||
                !TryParseBattery(response, out battery)) return false;
            // Aurora receiver firmware can return zero with no wireless link.
            if (!receiver || battery.Percentage != 0) return true;
            battery = null;
            return false;
        }

        public static bool TryParseBattery(byte[] response, out LamzuParoBatteryInformation battery)
        {
            battery = null;
            if (response == null || response.Length < 9 || response[0] != 0x00 ||
                response[1] != 0xA1 || response[6] != 0x83 || response[7] > 1 ||
                response[8] > 100)
            {
                return false;
            }
            battery = new LamzuParoBatteryInformation
            {
                Percentage = response[8],
                Charging = response[7] == 1
            };
            return true;
        }

        public static bool IsOffline(byte[] response)
        {
            return response != null && response.Length >= 9 &&
                response[0] == 0x00 && response[1] == 0xA4 && response[6] == 0x83;
        }
    }

    internal static class LamzuAuroraReader
    {
        private sealed class Profile
        {
            public readonly string Model;
            public readonly int Vendor, Cable;
            public readonly int[] Receivers;

            public Profile(string model, int vendor, int cable, params int[] receivers)
            {
                Model = model; Vendor = vendor; Cable = cable; Receivers = receivers;
            }

            public bool Owns(int vendor, int product)
            {
                return Vendor == vendor && (Cable == product || Receivers.Contains(product));
            }
        }

        // Exact Aurora model/route pairs with known transport. Shared or
        // ambiguous IDs are left to a future model-specific check.
        private static readonly Profile[] Profiles = {
            new Profile("Paro", 0x37B0, 0x0007, 0x000D, 0x000E),
            new Profile("Maya X", 0x373E, 0x001C, 0x001D, 0x001E),
            new Profile("Maya", 0x37B0, 0x0011, 0x0013, 0x0015),
            new Profile("Tachi", 0x37B0, 0x0005, 0x000B, 0x000C),
            new Profile("Inca", 0x37B0, 0x0009, 0x000F, 0x0010),
            new Profile("Thorn", 0x37B0, 0x0017, 0x0019, 0x001B),
            new Profile("Thorn V2", 0x37B0, 0x0021, 0x0003, 0x0023),
            new Profile("Atlantis OG Champion", 0x37B0, 0x0025, 0x0027),
            new Profile("Atlantis Mini", 0x37B0, 0x0028, 0x002A, 0x002B, 0x003F)
        };

        public static bool Handles(int vendor, int product)
        {
            return Profiles.Any(profile => profile.Owns(vendor, product));
        }

        public static string Scan(int attempts)
        {
            var devices = DeviceList.Local.GetHidDevices().Where(device =>
                Handles(device.VendorID, device.ProductID)).ToArray();
            var readings = new List<string>();
            foreach (var profile in Profiles)
            {
                var candidates = devices.Where(device => profile.Owns(device.VendorID, device.ProductID) &&
                    IsBatteryInterface(device, IsVerifiedParo(profile, device.ProductID))).ToArray();
                // An ID without a serial number cannot bind two identical
                // mice. Discard ambiguous paths within each transport.
                foreach (bool usb in new[] { true, false })
                {
                    var selected = candidates.Where(candidate => (candidate.ProductID == profile.Cable) == usb).ToArray();
                    if (selected.Length != 1) continue;
                    HidDevice device = selected[0];
                    bool beta = !IsVerifiedParo(profile, device.ProductID);
                    var battery = LamzuParoProtocol.ReadDevice(device, attempts, beta, !usb);
                    if (battery == null) continue;
                    readings.Add(FormatReading(profile, battery, usb, beta));
                    break;
                }
            }
            return "{\"source\":\"lamzu-aurora-hid\",\"devices\":[" + string.Join(",", readings.ToArray()) + "]}";
        }

        private static bool IsVerifiedParo(Profile profile, int pid)
        {
            return profile.Model == "Paro" && (pid == 0x0007 || pid == 0x000D);
        }

        private static bool IsBatteryInterface(HidDevice device, bool verified)
        {
            try
            {
                if (device.GetMaxFeatureReportLength() != 65) return false;
                if (verified)
                {
                    return (device.DevicePath ?? "").IndexOf("&MI_02#", StringComparison.OrdinalIgnoreCase) >= 0;
                }
                return HidCollection.Matches(device, 0xFFFF0000);
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }

        private static string FormatReading(Profile profile, LamzuParoBatteryInformation battery, bool usb, bool beta)
        {
            // Model labels originate only in the static profile catalog.
            return string.Format(CultureInfo.InvariantCulture,
                "{{\"vendorId\":\"{0:x4}\",\"productId\":\"{1:x4}\",\"model\":\"{2}\",\"transport\":\"{3}\",\"percentage\":{4},\"charging\":{5},\"beta\":{6}}}",
                profile.Vendor, battery.ProductId, profile.Model, usb ? "usb" : "receiver",
                battery.Percentage, battery.Charging ? "true" : "false", beta ? "true" : "false");
        }
    }

    internal static class LamzuParoJsonResult
    {
        public static string Build(LamzuParoBatteryInformation battery)
        {
            return string.Format(CultureInfo.InvariantCulture,
                "{{\"source\":\"lamzu-paro-hid\",\"transport\":\"{0}\",\"receiver\":{{\"vendorId\":\"0x37B0\",\"productId\":\"0x{1:X4}\"}},\"device\":{{\"name\":\"Lamzu Paro\",\"model\":\"Paro\"}},\"battery\":{{\"percentage\":{2},\"status\":\"{3}\",\"charging\":{4}}}}}",
                battery.ProductId == 0x0007 ? "usb" : "receiver",
                battery.ProductId,
                battery.Percentage,
                battery.Charging ? "charging" : "discharging",
                battery.Charging ? "true" : "false");
        }
    }

    internal static class LamzuParoSelfTest
    {
        public static void Run()
        {
            byte[] online = new byte[65];
            online[1] = 0xA1;
            online[6] = 0x83;
            online[8] = 92;
            LamzuParoBatteryInformation battery;
            if (!LamzuParoProtocol.TryParseBattery(online, out battery) ||
                battery.Percentage != 92 || battery.Charging)
            {
                throw new InvalidDataException("Lamzu Paro online response parsing failed.");
            }
            byte[] offline = new byte[65];
            offline[1] = 0xA4;
            offline[6] = 0x83;
            if (!LamzuParoProtocol.IsOffline(offline) ||
                LamzuParoProtocol.TryParseBattery(offline, out battery))
            {
                throw new InvalidDataException("Lamzu Paro offline response parsing failed.");
            }
            online[8] = 101;
            if (LamzuParoProtocol.TryParseBattery(online, out battery))
            {
                throw new InvalidDataException("Lamzu Paro accepted an invalid percentage.");
            }
            if (!LamzuAuroraReader.Handles(0x37B0, 0x000E) ||
                LamzuAuroraReader.Handles(0x37B0, 0x0000) ||
                !LamzuParoProtocol.TryParseAuroraBattery(new byte[] { 0xA1, 0, 2, 2, 0, 0x83, 1, 75 }, true, out battery) ||
                battery.Percentage != 75 || !battery.Charging ||
                LamzuParoProtocol.TryParseAuroraBattery(new byte[] { 0, 0xA1, 0, 2, 2, 0, 0x83, 0, 0 }, true, out battery) ||
                !LamzuParoProtocol.TryParseAuroraBattery(new byte[] { 0, 0xA1, 0, 2, 2, 0, 0x83, 0, 0 }, false, out battery))
            {
                throw new InvalidDataException("Lamzu Aurora beta parser self-test failed.");
            }
        }
    }
}
