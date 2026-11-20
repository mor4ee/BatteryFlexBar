using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using HidSharp;
using HidSharp.Reports;

namespace BatteryFlexBar.Native
{
    internal static class CommonHidBattery
    {
        private const int ScanBudgetMs = 2200;
        private const int ReplyTimeoutMs = 450;

        private sealed class Profile
        {
            public readonly int Vendor, Product, Interface;
            public readonly string Name;
            public readonly bool Cable;

            public Profile(int vendor, int product, string name, bool cable = false, int iface = -1)
            {
                Vendor = vendor;
                Product = product;
                Name = name;
                Cable = cable;
                Interface = iface;
            }
        }

        private static readonly Profile[] Compx = {
            new Profile(0x3554, 0xF58A, "VXE Dragonfly R1 Pro Max"),
            new Profile(0x3554, 0xF58C, "VXE Dragonfly R1 Pro Max", cable: true),
            new Profile(0x3554, 0xF58E, "VXE Dragonfly R1"),
            new Profile(0x3554, 0xF58F, "VXE Dragonfly R1", cable: true),
            new Profile(0x3554, 0xF505, "VGN Dragonfly 4K"),
            new Profile(0x3554, 0xF506, "VGN Dragonfly 4K", cable: true),
            new Profile(0x3554, 0xF508, "Pulsar Nordic mouse"),
            new Profile(0x3554, 0xF507, "Pulsar Nordic mouse", cable: true),
            new Profile(0x3710, 0x5406, "Pulsar 8K receiver"),
            new Profile(0x3710, 0x3414, "Pulsar X2 CrazyLight Mini", cable: true),
            new Profile(0x3770, 0x0200, "Hitscan Hyperlight"),
            new Profile(0x3770, 0x0100, "Hitscan Hyperlight", cable: true),
            new Profile(0x373B, 0x1085, "ATK wireless mouse"),
            new Profile(0x373B, 0x101A, "ATK X1 Pro"),
            new Profile(0x373B, 0x101B, "ATK Fire X receiver"),
            new Profile(0x3554, 0xF55D, "Redragon wireless mouse"),
            new Profile(0x3554, 0xF55E, "Redragon wireless mouse", cable: true),
            new Profile(0x3554, 0xF5D5, "Taidu TSG808 receiver"),
            new Profile(0x35BB, 0xD3FB, "HECATE wireless mouse"),
            new Profile(0x35BB, 0xD3FA, "HECATE mouse", cable: true),
            new Profile(0x35BB, 0xD3FC, "HECATE mouse", cable: true),
            new Profile(0x35BB, 0xD3FD, "HECATE mouse", cable: true),
            new Profile(0x1B1C, 0x2B2A, "Corsair Sabre V2 Pro Ultralight")
        };

        private static readonly Profile[] Sonix = {
            new Profile(0x05AC, 0x024F, "SONiX wireless keyboard", iface: 3),
            new Profile(0x0C45, 0xFDFD, "AJAZZ AK820 Pro", iface: 3),
            new Profile(0x0C45, 0xFEFE, "AJAZZ wireless keyboard", iface: 3),
            new Profile(0x342D, 0xE479, "EPOMAKER P75", iface: 1),
            new Profile(0x342D, 0xE485, "Royal Kludge R75"),
            new Profile(0x342D, 0xE4BC, "Redragon Arlokks K742B"),
            new Profile(0x342D, 0xE4C2, "M1 V5 VIA"),
            new Profile(0x342D, 0xE407, "Lucky65 V2"),
            new Profile(0x388D, 0x0002, "Lofree Flow2"),
            new Profile(0x388D, 0x0003, "Lofree Flow2"),
            new Profile(0x0DB0, 0x0CA0, "MSI FORGE TKL"),
            new Profile(0x36B0, 0x30BD, "Essential75"),
            new Profile(0x342D, 0xE51A, "NUT65"),
            new Profile(0x342D, 0xE487, "Royal Kludge wireless keyboard"),
            new Profile(0x342D, 0xE537, "WEIKAV MAX102"),
            new Profile(0x19F5, 0x3245, "NuPhy Air75 V2"),
            new Profile(0x362D, 0xD028, "SKN Qinglong"),
            new Profile(0x362D, 0xD030, "Lemokey Link keyboard"),
            new Profile(0x362D, 0xD101, "Wireless Link keyboard"),
            new Profile(0x342D, 0xE49F, "Spade65 QMK")
        };

        private sealed class Route
        {
            public HidDevice Device;
            public Profile Profile;
            public Guid Container;
        }

        public static string ReadJson(bool keyboard)
        {
            return SystemBatteryJson.Build(keyboard ? "sonix-keyboard" : "compx-mouse", Scan(keyboard));
        }

        public static bool OwnsCollection(HidDevice device, ReportDescriptor descriptor)
        {
            var compx = FindProfile(Compx, device);
            if (compx != null && MatchesCollection(device, descriptor, compx, false)) return true;
            var sonix = FindProfile(Sonix, device);
            return sonix != null && MatchesCollection(device, descriptor, sonix, true);
        }

        private static Profile FindProfile(Profile[] profiles, HidDevice device)
        {
            int vendor = device.VendorID;
            int product = device.ProductID;
            return profiles.FirstOrDefault(profile => profile.Vendor == vendor && profile.Product == product);
        }

        private static bool MatchesCollection(HidDevice device, ReportDescriptor descriptor, Profile profile, bool keyboard)
        {
            return MatchesInterface(device.DevicePath, profile.Interface) &&
                MatchesReportLayout(descriptor, keyboard, device.GetMaxInputReportLength(), device.GetMaxOutputReportLength());
        }

        internal static bool MatchesReportLayout(ReportDescriptor descriptor, bool keyboard, int inputLength, int outputLength)
        {
            if (descriptor == null) return false;
            byte reportId = keyboard ? (byte)0 : (byte)8;
            int length = keyboard ? 33 : 17;
            int maxLength = keyboard ? 33 : 65;
            uint usage = keyboard ? 0xFF600061u : 0xFF020002u;
            if (inputLength < length || inputLength > maxLength ||
                outputLength < length || outputLength > maxLength) return false;
            return descriptor.DeviceItems.Any(item => item.Usages.ContainsValue(usage) &&
                item.InputReports.Any(report => report.ReportID == reportId && report.Length >= length && report.Length <= inputLength) &&
                item.OutputReports.Any(report => report.ReportID == reportId && report.Length >= length && report.Length <= outputLength));
        }

        internal static bool MatchesInterface(string path, int expected)
        {
            if (expected < 0) return true;
            if (string.IsNullOrEmpty(path)) return false;
            string token = "&MI_" + expected.ToString("X2", CultureInfo.InvariantCulture);
            return path.IndexOf(token + "#", StringComparison.OrdinalIgnoreCase) >= 0 ||
                path.IndexOf(token + "&", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static IEnumerable<SystemBatteryReading> Scan(bool keyboard)
        {
            var timer = Stopwatch.StartNew();
            var routes = new List<Route>();
            foreach (HidDevice device in DeviceList.Local.GetHidDevices())
            {
                if (timer.ElapsedMilliseconds >= ScanBudgetMs) yield break;
                var profile = FindProfile(keyboard ? Sonix : Compx, device);
                if (profile == null) continue;
                try
                {
                    Guid container;
                    if (!UsbHidIdentity.TryGetContainer(device.DevicePath, out container) ||
                        !MatchesCollection(device, device.GetReportDescriptor(), profile, keyboard)) continue;
                    routes.Add(new Route { Device = device, Profile = profile, Container = container });
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
                catch (NotSupportedException) { }
            }
            foreach (var group in routes.GroupBy(route => route.Container).OrderBy(group => group.Key))
            {
                if (timer.ElapsedMilliseconds >= ScanBudgetMs) yield break;
                // Never guess which of two indistinguishable collections is the battery channel.
                if (group.Count() != 1) continue;
                var reading = TryRead(group.First(), keyboard, timer);
                if (reading != null) yield return reading;
            }
        }

        private static SystemBatteryReading TryRead(Route route, bool keyboard, Stopwatch timer)
        {
            try
            {
                HidStream stream;
                if (!route.Device.TryOpen(out stream)) return null;
                using (stream)
                    return keyboard ? ReadSonix(route, stream, timer) : ReadCompx(route, stream, timer);
            }
            catch (IOException) { return null; }
            catch (TimeoutException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
        }

        private static SystemBatteryReading ReadCompx(Route route, HidStream stream, Stopwatch timer)
        {
            if (!route.Profile.Cable)
            {
                var link = QueryCompx(route.Device, stream, 0x03, timer);
                if (link == null || link[6] != 1) return null;
            }
            var battery = QueryCompx(route.Device, stream, 0x04, timer);
            int? percent = DecodeCompxBattery(battery);
            if (!percent.HasValue) return null;
            return new SystemBatteryReading(route.Container, route.Profile.Name, percent.Value,
                route.Profile.Cable ? "usb" : "receiver", battery[7] == 1);
        }

        private static byte[] QueryCompx(HidDevice device, HidStream stream, byte command, Stopwatch timer)
        {
            int timeout = Remaining(timer);
            if (timeout <= 0) return null;
            byte[] request = BuildCompxRequest(device.GetMaxOutputReportLength(), command);
            return HidOutputQuery.ReadReply(stream, request, device.GetMaxInputReportLength(), 17,
                packet => MatchesCompxReply(packet, command), timeout);
        }

        internal static byte[] BuildCompxRequest(int reportLength, byte command)
        {
            if (command != 0x03 && command != 0x04) throw new ArgumentOutOfRangeException("command");
            var packet = new byte[reportLength];
            packet[0] = 8;
            packet[1] = command;
            packet[16] = CompxChecksum(packet);
            return packet;
        }

        private static bool MatchesCompxReply(byte[] packet, byte command)
        {
            return packet != null && packet.Length >= 17 && packet[0] == 8 &&
                packet[1] == command && packet[16] == CompxChecksum(packet);
        }

        private static byte CompxChecksum(byte[] packet)
        {
            int sum = 0;
            for (int index = 0; index < 16; index++) sum += packet[index];
            return unchecked((byte)(0x55 - sum));
        }

        internal static int? DecodeCompxBattery(byte[] packet)
        {
            return MatchesCompxReply(packet, 0x04) && packet[6] <= 100 && packet[7] <= 1
                ? (int?)packet[6] : null;
        }

        private static SystemBatteryReading ReadSonix(Route route, HidStream stream, Stopwatch timer)
        {
            byte[] request = BuildSonixRequest();
            for (int attempt = 0; attempt < 2; attempt++)
            {
                int timeout = Remaining(timer);
                if (timeout <= 0) break;
                byte[] reply = HidOutputQuery.ReadReply(stream, request, 33, 5, MatchesSonixReply, timeout);
                if (reply == null) continue;
                int? percent = DecodeSonixBattery(reply);
                if (!percent.HasValue) return null;
                return new SystemBatteryReading(route.Container, SonixName(route), percent.Value, "receiver");
            }
            return null;
        }

        internal static byte[] BuildSonixRequest()
        {
            var packet = new byte[33];
            packet[1] = 0x20;
            packet[2] = 1;
            packet[32] = 0x21; // Sum of the other payload bytes.
            return packet;
        }

        private static bool MatchesSonixReply(byte[] packet)
        {
            return packet != null && packet.Length >= 5 && packet[0] == 0 && packet[1] == 0x20 &&
                packet[2] == 1 && packet[3] == 0;
        }

        internal static int? DecodeSonixBattery(byte[] packet)
        {
            return MatchesSonixReply(packet) && packet[4] >= 1 && packet[4] <= 100 ? (int?)packet[4] : null;
        }

        private static string SonixName(Route route)
        {
            // VID/PID may be shared, so use the device's own keyboard label when available.
            try
            {
                string name = (route.Device.GetProductName() ?? "").Trim();
                if (name.Length > 0 && !name.Equals("2.4G Dongle", StringComparison.OrdinalIgnoreCase) &&
                    !name.Equals("Wireless Keyboard", StringComparison.OrdinalIgnoreCase))
                {
                    return name.EndsWith(" 2.4G", StringComparison.OrdinalIgnoreCase) && name.Length > 5
                        ? name.Substring(0, name.Length - 5).TrimEnd() : name;
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            return route.Profile.Name;
        }

        private static int Remaining(Stopwatch timer)
        {
            return (int)Math.Min(ReplyTimeoutMs, ScanBudgetMs - timer.ElapsedMilliseconds);
        }
    }

    internal static class CommonHidBatterySelfTest
    {
        public static void Run()
        {
            var link = CommonHidBattery.BuildCompxRequest(65, 3);
            Check(link[0] == 8 && link[1] == 3 && link[16] == 0x4A && link.Skip(17).All(value => value == 0), "CompX link request");
            Check(CommonHidBattery.BuildCompxRequest(17, 4)[16] == 0x49, "CompX battery request");
            // Captured from the Pulsar X2 CrazyLight Mini over USB (HaloBattery #164).
            var reply = new byte[] { 8, 4, 0, 0, 0, 2, 0x19, 1, 0x0E, 0x52, 0, 0, 0, 0, 0, 0, 0xCD };
            Check(CommonHidBattery.DecodeCompxBattery(reply) == 25, "CompX hardware capture");
            reply[16]++;
            Check(!CommonHidBattery.DecodeCompxBattery(reply).HasValue, "CompX corrupted checksum");
            Check(!CommonHidBattery.DecodeCompxBattery(link).HasValue, "CompX refuses a link response as battery");

            var sonix = CommonHidBattery.BuildSonixRequest();
            Check(sonix.Length == 33 && sonix[0] == 0 && sonix[1] == 0x20 && sonix[2] == 1 &&
                sonix[32] == 0x21, "SONiX request framing");
            Check(CommonHidBattery.DecodeSonixBattery(new byte[] { 0, 0x20, 1, 0, 73 }) == 73 &&
                !CommonHidBattery.DecodeSonixBattery(new byte[] { 0, 0x20, 1, 0, 0 }).HasValue &&
                !CommonHidBattery.DecodeSonixBattery(new byte[] { 0, 0x20, 2, 0, 73 }).HasValue, "SONiX reply and disconnected sentinel");
            Check(CommonHidBattery.MatchesInterface("hid#vid_05ac&pid_024f&mi_03&col01#", 3) &&
                !CommonHidBattery.MatchesInterface("hid#vid_05ac&pid_024f&mi_01#", 3), "separate shared SONiX and BY interfaces");
            var sonixDescriptor = new ReportDescriptor(new byte[] {
                0x06, 0x60, 0xFF, 0x09, 0x61, 0xA1, 1, // FF60:0061 application collection.
                0x15, 0, 0x26, 0xFF, 0, 0x75, 8, 0x95, 32, 0x09, 0x62, 0x81, 2,
                0x09, 0x63, 0x91, 2, 0xC0
            });
            var compxDescriptor = new ReportDescriptor(new byte[] {
                0x06, 0x02, 0xFF, 0x09, 2, 0xA1, 1, 0x85, 8, // FF02:0002, report ID 8.
                0x15, 0, 0x26, 0xFF, 0, 0x75, 8, 0x95, 16, 0x09, 3, 0x81, 2,
                0x09, 4, 0x91, 2, 0xC0
            });
            Check(CommonHidBattery.MatchesReportLayout(sonixDescriptor, true, 33, 33) &&
                !CommonHidBattery.MatchesReportLayout(sonixDescriptor, true, 33, 65) &&
                !CommonHidBattery.MatchesReportLayout(sonixDescriptor, false, 33, 33), "SONiX descriptor gate");
            Check(CommonHidBattery.MatchesReportLayout(compxDescriptor, false, 65, 17) &&
                !CommonHidBattery.MatchesReportLayout(compxDescriptor, false, 17, 16) &&
                !CommonHidBattery.MatchesReportLayout(compxDescriptor, true, 33, 33), "CompX descriptor gate");
        }

        private static void Check(bool result, string message)
        {
            if (!result) throw new InvalidDataException("Common HID battery self-test failed: " + message);
        }
    }
}
