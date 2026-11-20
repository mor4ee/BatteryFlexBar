using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using HidSharp;

namespace BatteryFlexBar.Native
{
    internal static class HidCollection
    {
        public static bool Matches(HidDevice device, uint usage)
        {
            try
            {
                return device.GetReportDescriptor().DeviceItems.Any(item => item.Usages.ContainsValue(usage));
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            catch (ArgumentException) { return false; }
            catch (InvalidOperationException) { return false; }
            catch (NotSupportedException) { return false; }
        }
    }

    internal static class KeychronReceiver
    {
        private const int VendorId = 0x3434;
        private const int Link1kUsbA = 0xD030;
        private const int Link1kUsbC = 0xD031;
        private const int Link4k = 0xD038;
        private const int UltraLink8k = 0xD028;

        public static bool Handles(int receiverProductId)
        {
            return receiverProductId == Link1kUsbA || receiverProductId == Link1kUsbC ||
                receiverProductId == Link4k || receiverProductId == UltraLink8k;
        }

        public static KeychronBatteryInformation Read(int receiverProductId, int timeoutMs, int attempts)
        {
            if (!Handles(receiverProductId))
                throw new ArgumentException("Unsupported Keychron receiver product ID.");

            HidDevice[] matches = DeviceList.Local.GetHidDevices(VendorId, receiverProductId)
                .Where(device => MatchesReceiver(device, receiverProductId)).ToArray();
            if (matches.Length != 1)
                throw new DeviceNotFoundException("A unique Keychron mouse collection was not found.");

            HidDevice receiver = matches[0];
            KeychronBatteryInformation reading;
            switch (receiverProductId)
            {
                case Link4k: reading = Read4k(receiver, timeoutMs); break;
                case UltraLink8k: reading = Read8k(receiver, timeoutMs); break;
                default:
                    bool statusSeen;
                    reading = Read1k(receiver, out statusSeen);
                    // Old 1K firmware may expose only monitoring frames. Keep
                    // the existing D030 M6 route when the status command is
                    // unsupported, never when it reports an offline mouse.
                    if (reading == null && !statusSeen && receiverProductId == Link1kUsbA &&
                        receiver.GetMaxInputReportLength() == 33)
                    {
                        reading = KeychronRfProtocol.ReadBattery(receiver, timeoutMs, attempts);
                    }
                    break;
            }
            if (reading == null)
                throw new DeviceNotFoundException("Keychron receiver did not report valid battery status.");
            return reading;
        }

        private static bool MatchesReceiver(HidDevice device, int pid)
        {
            switch (pid)
            {
                case Link4k:
                    return device.GetMaxInputReportLength() == 65 &&
                        device.GetMaxOutputReportLength() == 65 && HidCollection.Matches(device, 0xFF0A0001);
                case UltraLink8k:
                    return device.GetMaxInputReportLength() >= 21 && device.GetMaxInputReportLength() <= 65 &&
                        device.GetMaxOutputReportLength() >= 21 && device.GetMaxOutputReportLength() <= 65 &&
                        HidCollection.Matches(device, 0xFFC10001);
                default:
                    return device.GetMaxFeatureReportLength() >= 13 && device.GetMaxFeatureReportLength() <= 1001 &&
                        (device.DevicePath ?? "").IndexOf("&MI_01#", StringComparison.OrdinalIgnoreCase) >= 0 &&
                        HidCollection.Matches(device, 0x008C0001);
            }
        }

        private static KeychronBatteryInformation Read1k(HidDevice device, out bool statusSeen)
        {
            statusSeen = false;
            try
            {
                using (var stream = device.Open())
                {
                    var packet = new byte[device.GetMaxFeatureReportLength()];
                    packet[0] = 0x51;
                    packet[1] = 0x06;
                    stream.SetFeature(packet);
                    for (int i = 0; i < 4; i++)
                    {
                        Thread.Sleep(40);
                        Array.Clear(packet, 0, packet.Length);
                        packet[0] = 0x51;
                        stream.GetFeature(packet);
                        if (packet[0] != 0x51 || packet[1] != 0x06) continue;
                        statusSeen = true;
                        var reading = Parse1k(packet);
                        if (reading != null) return reading;
                    }
                }
            }
            catch (IOException) { }
            catch (TimeoutException) { }
            return null;
        }

        internal static KeychronBatteryInformation Parse1k(byte[] packet)
        {
            if (packet == null || packet.Length < 13 || packet[0] != 0x51 || packet[1] != 0x06 ||
                packet[2] != 1 || Word(packet, 4) != VendorId || (packet[10] & 0x08) == 0 ||
                packet[11] > 100 || packet[12] > 1) return null;

            string model;
            switch (Word(packet, 6))
            {
                case 0xD032: case 0xD033: model = "M3"; break;
                case 0xD035: model = "M1"; break;
                case 0xD036: case 0xD03E: model = "M3 mini"; break;
                case 0xD03B: model = "M2"; break;
                case 0xD03D: model = "M2 mini"; break;
                case 0xD03F: model = "M6"; break;
                case 0xD044: model = "M7"; break;
                default: return null;
            }
            return Reading(model, "link-1k", packet[11], packet[12] == 1, packet, 13);
        }

        private static KeychronBatteryInformation Read4k(HidDevice device, int timeoutMs)
        {
            using (var stream = device.Open())
            {
                byte[] route = Query4k(device, stream, 0x01, 1, timeoutMs);
                if (!Is4kRoute(route)) return null;
                byte[] mouse = Query4k(device, stream, 0x40, 0, timeoutMs);
                if (mouse == null) return null;
                string model = Model4k(Word(mouse, 5));
                if (model == null) return null;
                return Parse4k(Query4k(device, stream, 0x41, 1, timeoutMs), model);
            }
        }

        internal static bool Is4kRoute(byte[] packet)
        {
            if (packet == null || packet.Length < 13 || packet[0] != 0 || packet[1] != 0x01 || packet[4] != 1) return false;
            int tag = Word(packet, 7);
            return tag != 0x3434 && tag != 0x362D;
        }

        private static string Model4k(int pid)
        {
            switch (pid)
            {
                case 0x0620: case 0x0622: return "M3 mini 4K";
                case 0x0621: return "M4 4K";
                case 0x0624: return "M6 4K";
                case 0x07A0: return "M3 4K";
                default: return null;
            }
        }

        internal static KeychronBatteryInformation Parse4k(byte[] packet, string model)
        {
            if (packet == null || packet.Length < 13 || packet[0] != 0 || packet[1] != 0x41 ||
                packet[4] != 1 || packet[6] > 3 || packet[7] < 1 || packet[7] > 100) return null;
            return Reading(model, "link-4k", packet[7], packet[6] != 0, packet, 13);
        }

        private static byte[] Query4k(HidDevice device, HidStream stream, byte command, byte subcommand, int timeoutMs)
        {
            var request = new byte[65];
            request[1] = command;
            request[3] = 0x81;
            request[4] = subcommand;
            request[64] = unchecked((byte)(0xA1 - command - 0x81 - subcommand));
            return HidOutputQuery.ReadReply(stream, request, device.GetMaxInputReportLength(), 13, reply =>
                reply[0] == 0 && reply[1] == command && reply[4] == subcommand, timeoutMs);
        }

        private static KeychronBatteryInformation Read8k(HidDevice device, int timeoutMs)
        {
            using (var stream = device.Open())
            {
                int? pid = Active8kMouse(Query8k(device, stream, 0xB5, 0x03, timeoutMs));
                if (!pid.HasValue) return null;
                return Parse8k(Query8k(device, stream, 0xB3, 0x06, timeoutMs), pid.Value);
            }
        }

        internal static int? Active8kMouse(byte[] packet)
        {
            if (packet == null || packet.Length < 21 || packet[0] != 0xB5 || packet[1] != 0x03) return null;
            int? pid = null;
            for (int pos = 3; pos <= 13; pos += 5)
            {
                if (packet[pos + 4] != 1) continue;
                // The following B3 query is not slot-addressed.
                int product = Word(packet, pos + 2);
                if (pid.HasValue || Word(packet, pos) != VendorId || product == 0) return null;
                pid = product;
            }
            return pid;
        }

        internal static KeychronBatteryInformation Parse8k(byte[] packet, int pid)
        {
            if (packet == null || packet.Length < 21 || packet[0] != 0xB3 || packet[1] != 0x06) return null;
            int percent = packet[20] & 0x7F;
            if (percent < 1 || percent > 100) return null;
            string model = string.Format(CultureInfo.InvariantCulture, "Ultra-Link 8K ({0:X4})", pid);
            return Reading(model, "ultra-link-8k", percent, (packet[20] & 0x80) != 0, packet, 21);
        }

        private static byte[] Query8k(HidDevice device, HidStream stream, byte report, byte command, int timeoutMs)
        {
            var request = new byte[device.GetMaxOutputReportLength()];
            request[0] = report;
            request[1] = command;
            return HidOutputQuery.ReadReply(stream, request, device.GetMaxInputReportLength(), 21, reply =>
                reply[0] == report && reply[1] == command, timeoutMs);
        }

        private static int Word(byte[] packet, int index)
        {
            return packet[index] | (packet[index + 1] << 8);
        }

        private static KeychronBatteryInformation Reading(string model, string protocol, int percent, bool charging, byte[] packet, int evidenceLength)
        {
            return new KeychronBatteryInformation { Model = model, Protocol = protocol, Percentage = percent,
                Charging = charging, RawResponse = Hex.Spaced(packet.Take(evidenceLength).ToArray()) };
        }
    }

    internal static class KeychronReceiverSelfTest
    {
        public static void Run()
        {
            var m7 = new byte[] { 0x51, 0x06, 1, 0, 0x34, 0x34, 0x44, 0xD0, 0, 0, 8, 76, 1 };
            var reading = KeychronReceiver.Parse1k(m7);
            Check(reading != null && reading.Model == "M7" && reading.Percentage == 76 && reading.Charging, "M7 identity and charge");
            m7[10] = 0;
            Check(KeychronReceiver.Parse1k(m7) == null, "1K offline cached percent");
            var reply4k = new byte[] { 0, 0x41, 0, 0, 1, 0, 1, 87, 0, 0, 0, 0, 0 };
            reading = KeychronReceiver.Parse4k(reply4k, "M6 4K");
            Check(reading != null && reading.Percentage == 87 && reading.Charging, "4K battery offset");
            reply4k[7] = 0;
            Check(KeychronReceiver.Parse4k(reply4k, "M6 4K") == null, "4K zero may indicate offline");
            var slots = new byte[21];
            slots[0] = 0xB5; slots[1] = 3;
            slots[8] = slots[9] = 0x34; slots[10] = 0x49; slots[11] = 0xD0; slots[12] = 1;
            Check(KeychronReceiver.Active8kMouse(slots) == 0xD049, "one active 8K slot");
            slots[7] = 1;
            Check(!KeychronReceiver.Active8kMouse(slots).HasValue, "ambiguous 8K slots");
            var reply8k = new byte[21];
            reply8k[0] = 0xB3; reply8k[1] = 6; reply8k[20] = 0xE4;
            reading = KeychronReceiver.Parse8k(reply8k, 0xD049);
            Check(reading != null && reading.Percentage == 100 && reading.Charging, "8K packed power");
            reply8k[0] = 0xB5;
            Check(KeychronReceiver.Parse8k(reply8k, 0xD049) == null, "wrong 8K report");
        }

        private static void Check(bool condition, string scenario)
        {
            if (!condition) throw new InvalidDataException("Keychron receiver self-test failed: " + scenario);
        }
    }
}
