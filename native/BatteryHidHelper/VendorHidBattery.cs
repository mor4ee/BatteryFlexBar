using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using HidSharp;

namespace BatteryFlexBar.Native
{
    internal static class VendorHidBattery
    {
        internal enum Protocol { Glorious, By, Evision, Rapoo, Razer, Corsair, HyperX, Aerox, Rog }

        internal sealed class Profile
        {
            public readonly Protocol Protocol;
            public readonly int Vid, Pid, Interface;
            public readonly uint Usage;
            public readonly string Name, Kind, Transport;

            public Profile(Protocol protocol, int vid, int pid, string name, string kind, string transport,
                int iface = -1, uint usage = 0)
            {
                Protocol = protocol; Vid = vid; Pid = pid; Name = name; Kind = kind;
                Transport = transport; Interface = iface; Usage = usage;
            }
        }

        private static readonly Profile[] Profiles = {
            new Profile(Protocol.Glorious, 0x258A, 0x2022, "Glorious Model O Wireless", "mouse", "receiver"),
            new Profile(Protocol.Glorious, 0x258A, 0x2011, "Glorious Model O Wireless", "mouse", "usb"),
            new Profile(Protocol.Glorious, 0x258A, 0x2023, "Glorious Model D Wireless", "mouse", "receiver"),
            new Profile(Protocol.Glorious, 0x258A, 0x2012, "Glorious Model D Wireless", "mouse", "usb"),
            new Profile(Protocol.Glorious, 0x258A, 0x2024, "Glorious Model O- Wireless", "mouse", "receiver"),
            new Profile(Protocol.Glorious, 0x258A, 0x2013, "Glorious Model O- Wireless", "mouse", "usb"),
            new Profile(Protocol.Glorious, 0x258A, 0x2025, "Glorious Model D- Wireless", "mouse", "receiver"),
            new Profile(Protocol.Glorious, 0x258A, 0x2014, "Glorious Model D- Wireless", "mouse", "usb"),
            new Profile(Protocol.Glorious, 0x258A, 0x2033, "Glorious Model O 2 Wireless", "mouse", "receiver"),
            new Profile(Protocol.Glorious, 0x258A, 0x2034, "Glorious Model D 2 PRO", "mouse", "receiver"),
            new Profile(Protocol.Glorious, 0x258A, 0x2036, "Glorious Model D 2 PRO", "mouse", "receiver"),
            new Profile(Protocol.Glorious, 0x258A, 0x201A, "Glorious Model D 2 PRO", "mouse", "usb"),
            new Profile(Protocol.By, 0x3554, 0xFA09, "AULA BY keyboard", "keyboard", "receiver", 1, 0xFF020002),
            new Profile(Protocol.By, 0x3554, 0xFB40, "AULA BY keyboard", "keyboard", "receiver", 1, 0xFF020002),
            new Profile(Protocol.By, 0x41E4, 0x2001, "MCHOSE BY keyboard", "keyboard", "receiver", 1, 0xFF020002),
            new Profile(Protocol.By, 0x05AC, 0x024F, "MCHOSE BY keyboard", "keyboard", "receiver", 1, 0xFF020002),
            new Profile(Protocol.Evision, 0x320F, 0x5055, "Evision keyboard", "keyboard", "usb", -1, 0xFF1C0092),
            new Profile(Protocol.Rapoo, 0x24AE, 0x1233, "Rapoo VT1 Pro Max", "mouse", "receiver", -1, 0xFF000002),
            new Profile(Protocol.Rapoo, 0x24AE, 0x4433, "Rapoo VT1 Pro Max", "mouse", "usb", -1, 0xFF000002),
            new Profile(Protocol.Rapoo, 0x24AE, 0x1215, "Rapoo VT3 Pro", "mouse", "receiver", -1, 0xFF000002),
            new Profile(Protocol.Rapoo, 0x24AE, 0x4415, "Rapoo VT3 Pro", "mouse", "usb", -1, 0xFF000002),
            new Profile(Protocol.Rapoo, 0x24AE, 0x1244, "Rapoo VT3 Pro Max", "mouse", "receiver", -1, 0xFF000002),
            new Profile(Protocol.Rapoo, 0x24AE, 0x1417, "Rapoo VT3 Max Gen 2", "mouse", "receiver", -1, 0xFF000002),
            new Profile(Protocol.Rapoo, 0x24AE, 0x4617, "Rapoo VT3 Max Gen 2", "mouse", "usb", -1, 0xFF000002),
            new Profile(Protocol.Rapoo, 0x24AE, 0x1414, "Rapoo VT9 Gen 2", "mouse", "receiver", -1, 0xFF000002),
            new Profile(Protocol.Rapoo, 0x24AE, 0x4614, "Rapoo VT9 Gen 2", "mouse", "usb", -1, 0xFF000002),
            new Profile(Protocol.Razer, 0x1532, 0x007A, "Razer Viper Ultimate", "mouse", "usb"),
            new Profile(Protocol.Razer, 0x1532, 0x007B, "Razer Viper Ultimate", "mouse", "receiver"),
            new Profile(Protocol.Razer, 0x1532, 0x025C, "Razer BlackWidow V3 Pro", "keyboard", "receiver"),
            new Profile(Protocol.Corsair, 0x1B1C, 0x2B00, "Corsair Scimitar Elite SE Wireless", "mouse", "receiver"),
            new Profile(Protocol.HyperX, 0x03F0, 0x0AB5, "HyperX Pulsefire Haste 2 Core Wireless", "mouse", "receiver", 2, 0xFF000001),
            new Profile(Protocol.HyperX, 0x03F0, 0x0F98, "HyperX Pulsefire Haste 2 Wireless", "mouse", "receiver", 2, 0xFF000001),
            new Profile(Protocol.HyperX, 0x03F0, 0x0DA0, "HyperX Pulsefire Haste 2 Mini", "mouse", "receiver", 2, 0xFF000001),
            new Profile(Protocol.Aerox, 0x1038, 0x1838, "SteelSeries Aerox 3 Wireless", "mouse", "receiver", 3),
            new Profile(Protocol.Aerox, 0x1038, 0x183A, "SteelSeries Aerox 3 Wireless", "mouse", "usb", 3),
            new Profile(Protocol.Aerox, 0x1038, 0x1890, "SteelSeries Aerox 3 Wireless Gen 2", "mouse", "receiver", 3),
            new Profile(Protocol.Aerox, 0x1038, 0x1892, "SteelSeries Aerox 3 Wireless Gen 2", "mouse", "usb", 3),
            new Profile(Protocol.Aerox, 0x1038, 0x1852, "SteelSeries Aerox 5 Wireless", "mouse", "receiver", 3),
            new Profile(Protocol.Aerox, 0x1038, 0x1854, "SteelSeries Aerox 5 Wireless", "mouse", "usb", 3),
            new Profile(Protocol.Rog, 0x0B05, 0x1A83, "ROG Azoth", "keyboard", "usb", 1),
            new Profile(Protocol.Rog, 0x0B05, 0x1A85, "ROG Azoth", "keyboard", "receiver", 1),
            new Profile(Protocol.Rog, 0x0B05, 0x1A92, "ROG Harpe Ace Aim Lab Edition", "mouse", "usb", 0),
            new Profile(Protocol.Rog, 0x0B05, 0x1A94, "ROG Harpe Ace Aim Lab Edition", "mouse", "receiver", 0)
        };

        private static readonly string[] EvisionNames = { "ATK V75X", "VGN S99", "VGN V98pro", "VGN V98pro V2",
            "VGN N75 PRO", "VGN VXE75", "VGN VXE75 V2", "VXE V87", "VXE V87 RGB" };

        private sealed class Route
        {
            public HidDevice Device;
            public Profile Profile;
            public Guid Id;
        }

        public static string ReadJson(bool passive)
        {
            var routes = new List<Route>();
            var devices = DeviceList.Local.GetHidDevices().ToArray();
            foreach (HidDevice device in devices)
            {
                var profile = Profiles.FirstOrDefault(p => p.Vid == device.VendorID && p.Pid == device.ProductID);
                if (profile == null || passive != (profile.Protocol == Protocol.Rapoo)) continue;
                try
                {
                    Guid id;
                    if (!Matches(device, profile) || !UsbHidIdentity.TryGetContainer(device.DevicePath, out id)) continue;
                    if (profile.Vid == 0x05AC && !devices.Any(sibling => IsBySibling(sibling, id))) continue;
                    routes.Add(new Route { Device = device, Profile = profile, Id = id });
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                catch (ArgumentException) { }
            }
            // Do not guess which collection to write to if multiple match on the same physical device.
            var rows = routes.GroupBy(r => r.Id).Where(group => group.Count() == 1).Select(group => group.First())
                .OrderBy(route => route.Id).Take(8).AsParallel().WithDegreeOfParallelism(8)
                .Select(Read).Where(row => row != null).ToArray();
            return SystemBatteryJson.Build(passive ? "rapoo-passive" : "vendor-hid", rows.OrderBy(row => row.ContainerId));
        }

        internal static bool OwnsCollection(HidDevice device)
        {
            // Leave generic HID available on shared PIDs until device-family detection succeeds.
            var profile = Profiles.FirstOrDefault(p => p.Vid == device.VendorID && p.Pid == device.ProductID &&
                p.Vid != 0x05AC && p.Protocol != Protocol.Evision);
            if (profile == null) return false;
            try { return Matches(device, profile); }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            catch (ArgumentException) { return false; }
        }

        private static bool IsBySibling(HidDevice device, Guid id)
        {
            Guid other;
            return device.VendorID == 0x05AC && device.ProductID == 0x024F &&
                CommonHidBattery.MatchesInterface(device.DevicePath, 1) &&
                HidCollection.Matches(device, 0xFF040002) && device.GetMaxFeatureReportLength() > 0 &&
                UsbHidIdentity.TryGetContainer(device.DevicePath, out other) && id == other;
        }

        private static bool Matches(HidDevice device, Profile p)
        {
            if (p.Interface >= 0 && !CommonHidBattery.MatchesInterface(device.DevicePath, p.Interface)) return false;
            if (p.Usage != 0 && !HidCollection.Matches(device, p.Usage)) return false;
            var descriptor = device.GetReportDescriptor();
            var usages = descriptor.DeviceItems.SelectMany(item => item.Usages.GetAllValues()).ToArray();
            bool vendor = usages.Any(usage => usage >> 16 >= 0xFF00);
            int input = device.GetMaxInputReportLength(), output = device.GetMaxOutputReportLength();
            if (p.Protocol == Protocol.Glorious || p.Protocol == Protocol.Razer)
            {
                int length = p.Protocol == Protocol.Glorious ? 65 : 91;
                return vendor && device.GetMaxFeatureReportLength() == length &&
                    descriptor.FeatureReports.Any(report => report.ReportID == 0 && report.Length == length);
            }
            if (p.Protocol == Protocol.Rapoo)
            {
                bool modern = IsModernRapoo(p.Pid);
                return (modern ? input == 16 || input == 19 || (p.Pid == 0x1417 && input == 13) : input == 7) &&
                    descriptor.InputReports.Any(report => report.ReportID == (modern ? 0x07 : 0xBB));
            }
            if (!vendor || input > 128 || output > 128) return false;
            byte inputId = 0, outputId = 0;
            if (p.Protocol == Protocol.By) { if (input != 20 || output != 20) return false; inputId = outputId = 0x13; }
            if (p.Protocol == Protocol.Evision) { if (input != 64 || output != 64) return false; inputId = outputId = 4; }
            if (p.Protocol == Protocol.HyperX) { if (input != 64 || output != 64) return false; inputId = 0x53; outputId = 0x52; }
            if (p.Protocol == Protocol.Corsair && (input != 65 || output != 65 || !usages.Any(u => u >> 16 == 0xFF42)))
                return false;
            if (input < 12 || output < 12) return false;
            return descriptor.InputReports.Any(r => r.ReportID == inputId) && descriptor.OutputReports.Any(r => r.ReportID == outputId) &&
                (p.Protocol != Protocol.HyperX || (descriptor.InputReports.Any(r => r.ReportID == 0x51) &&
                    descriptor.OutputReports.Any(r => r.ReportID == 0x50)));
        }

        private static bool IsModernRapoo(int pid) { return pid == 0x1417 || pid == 0x4617 || pid == 0x1414 || pid == 0x4614; }

        private static SystemBatteryReading Read(Route route)
        {
            try
            {
                var p = route.Profile;
                string name = p.Name;
                if (p.Protocol == Protocol.Evision)
                {
                    string productName = route.Device.GetProductName();
                    if (string.IsNullOrEmpty(productName)) return null;
                    name = EvisionNames.FirstOrDefault(model => model.Equals(productName.Trim(), StringComparison.OrdinalIgnoreCase));
                    if (name == null) return null;
                }
                HidStream stream;
                if (!route.Device.TryOpen(out stream)) return null;
                using (stream)
                {
                    int step;
                    var level = ReadLevel(p, name, stream, route.Device.GetMaxInputReportLength(),
                        route.Device.GetMaxOutputReportLength(), out step);
                    return level == null ? null : new SystemBatteryReading(route.Id, name, level.Percent,
                        p.Transport, level.Charging, p.Kind, step);
                }
            }
            catch (IOException) { return null; }
            catch (TimeoutException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
            catch (ArgumentException) { return null; }
        }

        internal sealed class Level
        {
            public readonly int Percent;
            public readonly bool? Charging;
            public Level(int percent, bool? charging) { Percent = percent; Charging = charging; }
        }

        private static Level ReadLevel(Profile p, string name, HidStream stream, int input, int output, out int step)
        {
            step = 0;
            byte[] r;
            switch (p.Protocol)
            {
                case Protocol.Glorious:
                    var feature = new byte[65];
                    feature[3] = feature[4] = 2; feature[6] = 0x83;
                    for (int attempt = 0; attempt < 2; attempt++)
                    {
                        stream.SetFeature(feature); Thread.Sleep(100);
                        r = new byte[65]; stream.GetFeature(r);
                        LamzuParoBatteryInformation battery;
                        if (LamzuParoProtocol.TryParseBattery(r, out battery) && (p.Transport == "usb" || battery.Percentage != 0))
                            return new Level(battery.Percentage, battery.Charging);
                        if (r[1] != 0xA0 || r[6] != 0x83) break;
                        Thread.Sleep(400);
                    }
                    return null;
                case Protocol.By:
                    for (byte i = 0; i < 2; i++)
                    {
                        var req = new byte[20]; req[0] = 0x13; req[1] = 0x4A; req[2] = i; req[19] = Sum(req);
                        r = Query(stream, input, output, 20, x => DecodeBy(x, p.Vid != 0x3554) != null, 1500, req);
                        if (r != null) return DecodeBy(r, p.Vid != 0x3554);
                    }
                    return null;
                case Protocol.Evision:
                    var seq = new byte[2];
                    using (var random = RandomNumberGenerator.Create()) random.GetBytes(seq);
                    r = Query(stream, input, output, 10,
                        x => DecodeEvision(x, seq[0], seq[1]) != null, 2000,
                        4, seq[0], seq[1], 0x1A, name == "ATK V75X" ? (byte)0 : (byte)6);
                    return r == null ? null : DecodeEvision(r, seq[0], seq[1]);
                case Protocol.Rapoo:
                    return ReadPassive(stream, input, 6000, (data, count) => DecodeRapoo(data, count, p.Pid, p.Transport == "usb"));
                case Protocol.Razer:
                    byte transaction = p.Kind == "keyboard" ? (byte)0x9F : (byte)0x3F;
                    r = RazerQuery(stream, transaction, 0x80);
                    if (r == null && p.Kind == "mouse") r = RazerQuery(stream, transaction = 0xFF, 0x80);
                    if (r == null) return null;
                    var charge = RazerQuery(stream, transaction, 0x84);
                    return new Level((r[10] * 100 + 127) / 255, charge == null || charge[10] > 1 ? (bool?)null : charge[10] == 1);
                case Protocol.Corsair:
                    // Confirm that source slot 1 describes the known Scimitar Elite SE Wireless (2B22).
                    if (CorsairGet(stream, input, output, 0x12) != 0x2B22) return null;
                    uint? value = CorsairGet(stream, input, output, 0x0F);
                    if (!value.HasValue || value.Value == 0 || value.Value > 1000) return null;
                    uint? state = CorsairGet(stream, input, output, 0x10);
                    return new Level((int)(value.Value + 5) / 10, !state.HasValue || state.Value > 3 ? (bool?)null : state.Value == 1);
                case Protocol.HyperX:
                    r = Query(stream, input, output, 3, x => x[0] == 0x53 && x[1] == 1, 700, 0x52, 1);
                    if (r == null || r[2] == 0) return null;
                    r = Query(stream, input, output, 8, x => x[0] == 0x51 && x[1] == 2 && x[2] <= 100, 750, 0x50, 2);
                    return r == null ? null : new Level(r[2], r[3] <= 2 ? (bool?)(r[3] != 0) : null);
                case Protocol.Aerox:
                    byte cmd = p.Transport == "usb" ? (byte)0x92 : (byte)0xD2;
                    bool gen2 = p.Pid == 0x1890 || p.Pid == 0x1892;
                    r = Query(stream, input, output, gen2 ? 4 : 3, x => x[0] == 0 && x[1] == cmd, 400, 0, cmd);
                    step = gen2 ? 0 : 5;
                    return r == null ? null : DecodeAerox(r, gen2, p.Transport == "usb");
                case Protocol.Rog:
                    byte sub = p.Kind == "keyboard" ? (byte)1 : (byte)7;
                    r = Query(stream, input, output, 12, x => x[0] == 0 && x[1] == 0x12 && x[2] == sub, 500, 0, 0x12, sub);
                    if (r == null) return null;
                    int percent = r[sub == 1 ? 6 : 5];
                    return percent > 100 || (percent == 0 && sub == 7) ? null :
                        new Level(percent, sub == 1 ? r[9] == 1 : r[10] != 0);
                default: return null;
            }
        }

        private static byte[] Query(HidStream stream, int input, int output, int min,
            Func<byte[], bool> accepts, int timeout, params byte[] request)
        {
            Array.Resize(ref request, output);
            return HidOutputQuery.ReadReply(stream, request, input, min, accepts, timeout);
        }

        internal static T ReadPassive<T>(HidStream stream, int input, int timeout, Func<byte[], int, T> decode) where T : class
        {
            var timer = Stopwatch.StartNew();
            var data = new byte[input];
            while (timer.ElapsedMilliseconds < timeout)
            {
                stream.ReadTimeout = (int)Math.Max(1, timeout - timer.ElapsedMilliseconds);
                try
                {
                    T result = decode(data, stream.Read(data));
                    if (result != null) return result;
                }
                catch (TimeoutException) { break; }
            }
            return null;
        }

        private static uint? CorsairGet(HidStream stream, int input, int output, byte property)
        {
            var r = Query(stream, input, output, 8, x => x[0] == 0 && x[1] == 1 && x[2] == 2 && x[3] == 0,
                350, 0, 9, 2, property);
            return r == null ? (uint?)null : (uint)(r[4] | (r[5] << 8) | (r[6] << 16) | (r[7] << 24));
        }

        private static byte[] RazerQuery(HidStream stream, byte transaction, byte command)
        {
            var request = new byte[91];
            request[2] = transaction; request[6] = 2; request[7] = 7; request[8] = command;
            request[89] = RazerCrc(request);
            stream.SetFeature(request);
            for (int attempt = 0; attempt < 5; attempt++)
            {
                Thread.Sleep(25);
                var r = new byte[91]; stream.GetFeature(r);
                if (r[0] != 0 || r[2] != transaction || r[3] != 0 || r[4] != 0 || r[5] != 0 ||
                    r[6] != 2 || r[7] != 7 || r[8] != command || r[89] != RazerCrc(r)) continue;
                if (r[1] == 2) return r;
                if (r[1] != 1) break;
            }
            return null;
        }

        internal static byte RazerCrc(byte[] data)
        {
            byte crc = 0;
            for (int i = 3; i < 89; i++) crc ^= data[i];
            return crc;
        }

        internal static Level DecodeAerox(byte[] data, bool gen2, bool usb)
        {
            if (gen2)
                return data.Length < 4 || data[2] > 2 || data[3] > 100 || (!usb && data[2] == 0 && data[3] == 0)
                    ? null : new Level(data[3], data[2] != 0);
            if (data.Length < 3) return null;
            int code = data[2] & 0x7F;
            return code < 1 || code > 21 ? null : new Level((code - 1) * 5, (data[2] & 0x80) != 0);
        }

        internal static Level DecodeRapoo(byte[] data, int count, int pid, bool usb)
        {
            if (count > data.Length) return null;
            if (!IsModernRapoo(pid))
                return count != 7 || data[0] != 0xBB || data[1] != 0xB0 || (data[5] != 1 && data[5] != 2) || data[6] > 100
                    ? null : new Level(data[6], data[5] == 2);
            if ((count != 13 && count != 16 && count != 19) || data[0] != 7 || (data[1] & 0xF) != (usb ? 2 : 0) ||
                (data[7] != 1 && data[7] != 2) || data[8] > 100) return null;
            return new Level(data[8], data[7] == 2);
        }

        internal static Level DecodeEvision(byte[] data, byte sequence1, byte sequence2)
        {
            return data.Length < 10 || data[0] != 4 || data[1] != sequence1 || data[2] != sequence2 ||
                data[3] != 0x1A || data[5] != 0 || data[6] != 0 || data[8] > 100 || data[9] > 2
                ? null : new Level(data[8], data[9] != 0);
        }

        internal static Level DecodeBy(byte[] data, bool mchose)
        {
            if (data.Length < 20 || data[0] != 0x13 || (data[1] & 0x7F) != 0x4A || data[5] == 0 || data[5] > 100) return null;
            if (data[19] != Sum(data) && !(mchose && data[19] == 0 && data[2] == 1 && data[3] == 0)) return null;
            return new Level(data[5], (data[6] >> 4) == 1);
        }

        internal static byte Sum(byte[] data)
        {
            int sum = 0;
            for (int i = 1; i < 19; i++) sum += data[i];
            return unchecked((byte)sum);
        }

        public static void SelfTest()
        {
            var by = new byte[20]; by[0] = 0x13; by[1] = 0xCA; by[5] = 48; by[6] = 0x10; by[19] = Sum(by);
            Check(DecodeBy(by, false).Percent == 48 && DecodeBy(by, false).Charging == true, "BY battery");
            by[19]++; Check(DecodeBy(by, false) == null, "BY checksum");
            var ev = new byte[] { 4, 81, 12, 0x1A, 0, 0, 0, 0, 100, 2 };
            Check(DecodeEvision(ev, 81, 12).Percent == 100 && DecodeEvision(ev, 80, 12) == null, "Evision sequence");
            var rapoo = new byte[] { 0xBB, 0xB0, 0x71, 0x84, 3, 2, 95 };
            Check(DecodeRapoo(rapoo, 7, 0x4433, true).Charging == true && DecodeRapoo(rapoo, 7, 0x1417, false) == null, "Rapoo report");
            Check(DecodeAerox(new byte[] { 0, 0xD2, 0x91 }, false, false).Percent == 80 &&
                DecodeAerox(new byte[] { 0, 0xD2, 0, 0 }, true, false) == null, "Aerox levels and disconnected sentinel");
            var razer = new byte[91]; razer[2] = 0x3F; razer[6] = 2; razer[7] = 7; razer[8] = 0x80;
            Check(RazerCrc(razer) == 0x85, "Razer checksum");
        }

        private static void Check(bool condition, string name)
        {
            if (!condition) throw new InvalidDataException("Vendor HID self-test failed: " + name);
        }
    }
}
