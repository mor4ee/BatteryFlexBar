using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using HidSharp;
using HidSharp.Utility;

namespace BatteryFlexBar.Native
{
    internal static class Program
    {
        private const int LogitechVendorId = 0x046D;
        private const int DefaultBoltProductId = 0xC548;
        private const int DefaultModelId = 0xB042;

        private static int Main(string[] args)
        {
            try
            {
                Options options = Options.Parse(args);
                if (options.SelfTest)
                {
                    ProtocolSelfTest.Run();
                    DualSenseSelfTest.Run();
                    LamzuParoSelfTest.Run();
                    WindowsBluetoothSelfTest.Run();
                    StandardHidSelfTest.Run();
                    KeychronReceiverSelfTest.Run();
                    CommonHidBatterySelfTest.Run();
                    VendorHidBattery.SelfTest();
                    GamepadBattery.SelfTest();
                    Console.WriteLine("{\"selfTest\":\"ok\"}");
                    return 0;
                }

                if (options.DualSense)
                {
                    Console.WriteLine(DualSenseJsonResult.Build(DualSenseReader.ReadAll(
                        options.TimeoutMilliseconds,
                        options.Attempts,
                        options.EnableBluetoothDevices)));
                    return 0;
                }

                if (options.WindowsBluetooth)
                {
                    Console.OutputEncoding = new UTF8Encoding(false);
                    Console.WriteLine(WindowsBluetoothReader.ReadJson());
                    return 0;
                }

                if (options.StandardHid)
                {
                    Console.OutputEncoding = new UTF8Encoding(false);
                    Console.WriteLine(StandardHidReader.ReadJson());
                    return 0;
                }

                if (options.CompxMouse || options.SonixKeyboard)
                {
                    Console.OutputEncoding = new UTF8Encoding(false);
                    Console.WriteLine(CommonHidBattery.ReadJson(options.SonixKeyboard));
                    return 0;
                }

                if (options.VendorHid || options.RapooPassive || options.GamepadHid || options.XInput)
                {
                    Console.OutputEncoding = new UTF8Encoding(false);
                    Console.WriteLine(options.GamepadHid || options.XInput
                        ? GamepadBattery.ReadJson(options.XInput) : VendorHidBattery.ReadJson(options.RapooPassive));
                    return 0;
                }

                if (options.LamzuParo)
                {
                    Console.WriteLine(LamzuParoJsonResult.Build(
                        LamzuParoProtocol.ReadBattery(options.Attempts)));
                    return 0;
                }

                if (options.LamzuAurora)
                {
                    Console.WriteLine(LamzuAuroraReader.Scan(options.Attempts));
                    return 0;
                }

                if (options.KeychronRf)
                {
                    int receiverProductId = options.ReceiverProductId == DefaultBoltProductId ? 0xD030 : options.ReceiverProductId;
                    KeychronBatteryInformation battery = KeychronReceiver.Read(
                        receiverProductId,
                        options.TimeoutMilliseconds,
                        options.Attempts);
                    Console.WriteLine(KeychronJsonResult.Build(
                        receiverProductId,
                        battery));
                    return 0;
                }

                using (BoltHidpp transport = new BoltHidpp(LogitechVendorId, options.ReceiverProductId))
                {
                    DeviceInformation selectedDevice = null;
                    int selectedSlot = 0;
                    IEnumerable<int> slots = options.Slot.HasValue
                        ? new[] { options.Slot.Value }
                        : Enumerable.Range(1, 6);

                    for (int attempt = 0; attempt < options.Attempts && selectedDevice == null; attempt++)
                    {
                        foreach (int slot in slots)
                        {
                            try
                            {
                                DeviceInformation candidate = Protocol.ReadDeviceInformation(
                                    transport,
                                    slot,
                                    options.TimeoutMilliseconds);
                                if (candidate.ModelIds.Contains(options.ModelId))
                                {
                                    selectedDevice = candidate;
                                    selectedSlot = slot;
                                    break;
                                }
                            }
                            catch (HidppTimeoutException)
                            {
                                // Empty, offline, sleeping, or not-yet-awake pairing slot.
                            }
                            catch (InvalidDataException)
                            {
                                // A responsive slot that does not expose the expected feature shape.
                            }
                        }
                        if (selectedDevice == null && attempt + 1 < options.Attempts)
                        {
                            Thread.Sleep(25);
                        }
                    }

                    if (selectedDevice == null)
                    {
                        throw new DeviceNotFoundException(string.Format(
                            CultureInfo.InvariantCulture,
                            "Model 0x{0:X4} was not found on Logitech receiver 0x{1:X4}.",
                            options.ModelId,
                            options.ReceiverProductId));
                    }

                    BatteryInformation battery = null;
                    for (int attempt = 0; attempt < options.Attempts && battery == null; attempt++)
                    {
                        try
                        {
                            battery = Protocol.ReadBattery(
                                transport,
                                selectedSlot,
                                options.BatteryFeatureId,
                                options.TimeoutMilliseconds);
                        }
                        catch (HidppTimeoutException)
                        {
                            if (attempt + 1 >= options.Attempts) { throw; }
                            Thread.Sleep(25);
                        }
                    }
                    Console.WriteLine(JsonResult.Build(
                        LogitechVendorId,
                        options.ReceiverProductId,
                        options.ModelId,
                        options.BatteryFeatureId,
                        selectedSlot,
                        selectedDevice,
                        battery));
                }

                return 0;
            }
            catch (ArgumentException error)
            {
                Console.Error.WriteLine(error.Message);
                return 2;
            }
            catch (DeviceNotFoundException error)
            {
                Console.Error.WriteLine(error.Message);
                return 3;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.Message);
                return 4;
            }
            finally
            {
                HidSharpLibrary.ManualShutdown();
            }
        }
    }

    internal sealed class Options
    {
        public int ReceiverProductId = 0xC548;
        public int ModelId = 0xB042;
        public int BatteryFeatureId = 0x1004;
        public int? Slot;
        public int TimeoutMilliseconds = 400;
        public int Attempts = 2;
        public bool SelfTest;
        public bool KeychronRf;
        public bool DualSense;
        public bool LamzuParo;
        public bool LamzuAurora;
        public bool WindowsBluetooth;
        public bool StandardHid;
        public bool CompxMouse;
        public bool SonixKeyboard;
        public bool VendorHid, RapooPassive, GamepadHid, XInput;
        public readonly HashSet<string> EnableBluetoothDevices =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public static Options Parse(string[] args)
        {
            Options options = new Options();
            for (int index = 0; index < args.Length; index++)
            {
                string argument = args[index];
                if (argument == "--self-test")
                {
                    options.SelfTest = true;
                }
                else if (argument == "--keychron-rf")
                {
                    options.KeychronRf = true;
                }
                else if (argument == "--dualsense")
                {
                    options.DualSense = true;
                }
                else if (argument == "--lamzu-paro")
                {
                    options.LamzuParo = true;
                }
                else if (argument == "--lamzu-aurora")
                {
                    options.LamzuAurora = true;
                }
                else if (argument == "--windows-bluetooth")
                {
                    options.WindowsBluetooth = true;
                }
                else if (argument == "--standard-hid")
                {
                    options.StandardHid = true;
                }
                else if (argument == "--compx-mouse")
                {
                    options.CompxMouse = true;
                }
                else if (argument == "--sonix-keyboard")
                {
                    options.SonixKeyboard = true;
                }
                else if (argument == "--vendor-hid") { options.VendorHid = true; }
                else if (argument == "--rapoo-passive") { options.RapooPassive = true; }
                else if (argument == "--gamepad-hid") { options.GamepadHid = true; }
                else if (argument == "--xbox") { options.XInput = true; }
                else if (argument == "--enable-bt-device")
                {
                    string unitId = DualSenseIdentity.NormalizeUnitId(Next(args, ref index, argument));
                    if (unitId == null)
                    {
                        throw new ArgumentException("--enable-bt-device requires a valid controller unit ID.");
                    }
                    options.EnableBluetoothDevices.Add(unitId);
                }
                else if (argument == "--receiver-pid")
                {
                    options.ReceiverProductId = ParseInteger(Next(args, ref index, argument));
                }
                else if (argument == "--model-id")
                {
                    options.ModelId = ParseInteger(Next(args, ref index, argument));
                }
                else if (argument == "--battery-feature")
                {
                    int feature = ParseInteger(Next(args, ref index, argument));
                    if (feature != 0x1000 && feature != 0x1001 && feature != 0x1004)
                    {
                        throw new ArgumentException("--battery-feature must be 0x1000, 0x1001 or 0x1004.");
                    }
                    options.BatteryFeatureId = feature;
                }
                else if (argument == "--slot")
                {
                    int slot = ParseInteger(Next(args, ref index, argument));
                    if (slot < 1 || slot > 6) { throw new ArgumentException("--slot must be 1..6."); }
                    options.Slot = slot;
                }
                else if (argument == "--timeout-ms")
                {
                    int timeout = ParseInteger(Next(args, ref index, argument));
                    if (timeout < 50 || timeout > 10000)
                    {
                        throw new ArgumentException("--timeout-ms must be 50..10000.");
                    }
                    options.TimeoutMilliseconds = timeout;
                }
                else if (argument == "--attempts")
                {
                    int attempts = ParseInteger(Next(args, ref index, argument));
                    if (attempts < 1 || attempts > 5)
                    {
                        throw new ArgumentException("--attempts must be 1..5.");
                    }
                    options.Attempts = attempts;
                }
                else
                {
                    throw new ArgumentException("Unknown argument: " + argument);
                }
            }
            if ((options.DualSense ? 1 : 0) + (options.KeychronRf ? 1 : 0) +
                (options.LamzuParo ? 1 : 0) + (options.LamzuAurora ? 1 : 0) +
                (options.WindowsBluetooth ? 1 : 0) + (options.StandardHid ? 1 : 0) +
                (options.CompxMouse ? 1 : 0) + (options.SonixKeyboard ? 1 : 0) +
                (options.VendorHid ? 1 : 0) + (options.RapooPassive ? 1 : 0) +
                (options.GamepadHid ? 1 : 0) + (options.XInput ? 1 : 0) > 1)
            {
                throw new ArgumentException("Device modes cannot be combined.");
            }
            if (options.EnableBluetoothDevices.Count > 0 && !options.DualSense)
            {
                throw new ArgumentException("--enable-bt-device requires --dualsense.");
            }
            return options;
        }

        private static string Next(string[] args, ref int index, string argument)
        {
            index++;
            if (index >= args.Length) { throw new ArgumentException("Missing value for " + argument + "."); }
            return args[index];
        }

        private static int ParseInteger(string value)
        {
            if (value.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                return int.Parse(value.Substring(2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            }
            return int.Parse(value, NumberStyles.Integer, CultureInfo.InvariantCulture);
        }
    }

    internal sealed class KeychronBatteryInformation
    {
        public int Percentage;
        public bool Charging;
        public string RawResponse;
        public string Model;
        public string Protocol;
    }

    internal static class KeychronRfProtocol
    {
        private const byte FeatureReportId = 0x51;
        private const byte InputReportId = 0x54;

        public static KeychronBatteryInformation ReadBattery(
            HidDevice device,
            int timeoutMilliseconds,
            int attempts)
        {
            using (HidStream stream = device.Open())
            {
                stream.ReadTimeout = 20;
                stream.WriteTimeout = 500;
                Drain(stream);

                byte[][] commands =
                {
                    new byte[] { 0x0C, 0x02, 0x11 },
                    new byte[] { 0x07 },
                    new byte[] { 0x06 }
                };
                for (int attempt = 0; attempt < attempts; attempt++)
                {
                    foreach (byte[] command in commands)
                    {
                        byte[] feature = new byte[device.GetMaxFeatureReportLength()];
                        feature[0] = FeatureReportId;
                        Buffer.BlockCopy(command, 0, feature, 1, command.Length);
                        stream.SetFeature(feature);

                        Stopwatch timer = Stopwatch.StartNew();
                        while (timer.ElapsedMilliseconds < timeoutMilliseconds)
                        {
                            byte[] report;
                            if (!TryRead(stream, out report)) { continue; }
                            KeychronBatteryInformation battery;
                            if (MatchesVerifiedM6Monitor(report) && TryParseBattery(report, out battery)) return battery;
                        }
                    }
                    if (attempt + 1 < attempts) { Thread.Sleep(50); }
                }
            }

            return null;
        }

        internal static bool MatchesVerifiedM6Monitor(byte[] report)
        {
            // The legacy frame has no model PID. Limit the compatibility path
            // to the firmware token recorded from our M6 capture.
            byte[] marker = { 0x30, 0x2E, 0x31, 0x2E, 0x35, 0x2D, 0x33 };
            if (report == null || report.Length < 15 || report[0] != 0x54 || report[1] != 0xE3) return false;
            for (int i = 0; i < marker.Length; i++)
            {
                if (report[i + 8] != marker[i]) return false;
            }
            return report.Length == 15 || report[15] == 0;
        }

        public static bool TryParseBattery(
            byte[] report,
            out KeychronBatteryInformation battery)
        {
            battery = null;
            if (report == null || report.Length < 2) { return false; }
            int offset = report[0] == InputReportId ? 1 : 0;
            if (report.Length <= offset) { return false; }

            int percentage;
            bool charging;
            byte frame = report[offset];
            if (frame == 0xE2 && report.Length > offset + 4)
            {
                percentage = report[offset + 4];
                charging = report[offset + 3] != 0;
            }
            else if ((frame == 0xE3 || frame == 0xE6 || frame == 0xE7) &&
                report.Length > offset + 5)
            {
                percentage = report[offset + 4];
                charging = (report[offset + 5] & 0x01) != 0;
            }
            else
            {
                return false;
            }

            if (percentage < 0 || percentage > 100) { return false; }
            battery = new KeychronBatteryInformation
            {
                Percentage = percentage,
                Charging = charging,
                RawResponse = Hex.Spaced(report),
                Model = "M6",
                Protocol = "legacy-monitor"
            };
            return true;
        }

        private static void Drain(HidStream stream)
        {
            byte[] ignored;
            for (int i = 0; i < 32 && TryRead(stream, out ignored); i++) { }
        }

        private static bool TryRead(HidStream stream, out byte[] report)
        {
            try
            {
                report = stream.Read();
                return report != null && report.Length > 0;
            }
            catch (TimeoutException)
            {
                report = null;
                return false;
            }
        }
    }

    internal static class KeychronJsonResult
    {
        public static string Build(
            int receiverProductId,
            KeychronBatteryInformation battery)
        {
            StringBuilder json = new StringBuilder();
            json.Append('{');
            String(json, "source", "keychron-rf-hid");
            json.Append(',');
            String(json, "transport", "keychron-link-2.4ghz");
            json.Append(",\"receiver\":{");
            String(json, "vendorId", "0x3434");
            json.Append(',');
            String(json, "productId", string.Format(
                CultureInfo.InvariantCulture,
                "0x{0:X4}",
                receiverProductId));
            json.Append("},\"device\":{");
            String(json, "name", "Keychron " + battery.Model);
            json.Append(',');
            String(json, "model", battery.Model);
            json.Append("},\"battery\":{");
            json.Append("\"percentage\":").Append(battery.Percentage).Append(',');
            String(json, "status", battery.Charging ? "charging" : "discharging");
            json.Append(",\"charging\":").Append(battery.Charging ? "true" : "false");
            json.Append("},\"protocol\":{");
            String(json, "variant", battery.Protocol);
            json.Append(',');
            String(json, "rawResponse", battery.RawResponse);
            json.Append("}}");
            return json.ToString();
        }

        private static void String(StringBuilder builder, string key, string value)
        {
            builder.Append('\"').Append(key).Append("\":\"")
                .Append(value.Replace("\\", "\\\\").Replace("\"", "\\\""))
                .Append('\"');
        }
    }

    internal sealed class BoltHidpp : IDisposable
    {
        private const byte SoftwareId = 0x0D;
        private readonly HidStream shortStream;
        private readonly HidStream longStream;

        public BoltHidpp(int vendorId, int productId)
        {
            HidDevice shortDevice = null;
            HidDevice longDevice = null;
            foreach (HidDevice device in DeviceList.Local.GetHidDevices(vendorId, productId))
            {
                string path = device.DevicePath ?? string.Empty;
                if (path.IndexOf("&MI_02&COL01#", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    shortDevice = device;
                }
                else if (path.IndexOf("&MI_02&COL02#", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    longDevice = device;
                }
            }

            if (shortDevice == null || longDevice == null)
            {
                throw new DeviceNotFoundException(string.Format(
                    CultureInfo.InvariantCulture,
                    "Logitech receiver 0x{0:X4} HID++ collections were not found.",
                    productId));
            }

            shortStream = shortDevice.Open();
            try
            {
                longStream = longDevice.Open();
            }
            catch
            {
                shortStream.Dispose();
                throw;
            }

            shortStream.ReadTimeout = 5;
            longStream.ReadTimeout = 5;
            shortStream.WriteTimeout = 500;
            longStream.WriteTimeout = 500;
        }

        public byte[] Exchange(
            byte[] request,
            byte expectedDeviceIndex,
            byte expectedFeatureIndex,
            byte expectedFunctionSoftware,
            int timeoutMilliseconds)
        {
            Drain(shortStream);
            Drain(longStream);
            shortStream.Write(request);

            Stopwatch timer = Stopwatch.StartNew();
            while (timer.ElapsedMilliseconds < timeoutMilliseconds)
            {
                byte[] report;
                if (TryRead(shortStream, out report) && Matches(
                    report,
                    expectedDeviceIndex,
                    expectedFeatureIndex,
                    expectedFunctionSoftware))
                {
                    return report;
                }
                if (TryRead(longStream, out report) && Matches(
                    report,
                    expectedDeviceIndex,
                    expectedFeatureIndex,
                    expectedFunctionSoftware))
                {
                    return report;
                }
            }

            throw new HidppTimeoutException("Timed out waiting for HID++ response.");
        }

        public void Dispose()
        {
            shortStream.Dispose();
            longStream.Dispose();
        }

        private static void Drain(HidStream stream)
        {
            byte[] ignored;
            while (TryRead(stream, out ignored)) { }
        }

        private static bool TryRead(HidStream stream, out byte[] report)
        {
            try
            {
                report = stream.Read();
                return report != null && report.Length > 0;
            }
            catch (TimeoutException)
            {
                report = null;
                return false;
            }
        }

        private static bool Matches(
            byte[] report,
            byte deviceIndex,
            byte featureIndex,
            byte functionSoftware)
        {
            return report.Length >= 4 &&
                report[1] == deviceIndex &&
                report[2] == featureIndex &&
                report[3] == functionSoftware;
        }

        public static byte SoftwareIdentifier { get { return SoftwareId; } }
    }

    internal static class Protocol
    {
        public static DeviceInformation ReadDeviceInformation(
            BoltHidpp transport,
            int slot,
            int timeoutMilliseconds)
        {
            FeatureAddress feature = GetFeature(transport, slot, 0x0003, timeoutMilliseconds);
            byte software = BoltHidpp.SoftwareIdentifier;
            byte[] response = transport.Exchange(
                new byte[] { 0x10, (byte)slot, feature.Index, software, 0, 0, 0 },
                (byte)slot,
                feature.Index,
                software,
                timeoutMilliseconds);
            return DeviceInformation.Parse(response, feature);
        }

        public static BatteryInformation ReadBattery(
            BoltHidpp transport,
            int slot,
            int featureId,
            int timeoutMilliseconds)
        {
            FeatureAddress feature = GetFeature(transport, slot, featureId, timeoutMilliseconds);
            byte function = featureId == 0x1004 ? (byte)0x10 : (byte)0x00;
            byte functionSoftware = (byte)(function | BoltHidpp.SoftwareIdentifier);
            byte[] response = transport.Exchange(
                new byte[] { 0x10, (byte)slot, feature.Index, functionSoftware, 0, 0, 0 },
                (byte)slot,
                feature.Index,
                functionSoftware,
                timeoutMilliseconds);
            if (featureId == 0x1001) return BatteryInformation.ParseBatteryVoltage(response, feature);
            return featureId == 0x1000
                ? BatteryInformation.ParseBatteryStatus(response, feature)
                : BatteryInformation.ParseUnifiedBattery(response, feature);
        }

        private static FeatureAddress GetFeature(
            BoltHidpp transport,
            int slot,
            int featureId,
            int timeoutMilliseconds)
        {
            byte software = BoltHidpp.SoftwareIdentifier;
            byte[] response = transport.Exchange(
                new byte[]
                {
                    0x10,
                    (byte)slot,
                    0x00,
                    software,
                    (byte)((featureId >> 8) & 0xFF),
                    (byte)(featureId & 0xFF),
                    0x00
                },
                (byte)slot,
                0x00,
                software,
                timeoutMilliseconds);
            if (response.Length < 7 || response[4] == 0)
            {
                throw new InvalidDataException(string.Format(
                    CultureInfo.InvariantCulture,
                    "HID++ feature 0x{0:X4} is unavailable.",
                    featureId));
            }
            return new FeatureAddress(response[4], response[6]);
        }
    }

    internal sealed class FeatureAddress
    {
        public readonly byte Index;
        public readonly byte Version;

        public FeatureAddress(byte index, byte version)
        {
            Index = index;
            Version = version;
        }
    }

    internal sealed class DeviceInformation
    {
        public FeatureAddress Feature;
        public string UnitId;
        public int TransportFlags;
        public int[] ModelIds;
        public int ExtendedModelId;

        public static DeviceInformation Parse(byte[] response, FeatureAddress feature)
        {
            if (response == null || response.Length < 19)
            {
                throw new InvalidDataException("Device Information response is too short.");
            }
            return new DeviceInformation
            {
                Feature = feature,
                UnitId = Hex.Compact(response, 5, 4),
                TransportFlags = response[10],
                ModelIds = new[]
                {
                    (response[11] << 8) | response[12],
                    (response[13] << 8) | response[14],
                    (response[15] << 8) | response[16]
                },
                ExtendedModelId = response[17]
            };
        }
    }

    internal sealed class BatteryInformation
    {
        // Sparse calibration landmarks from the host's G-series discharge curve.
        // The device gives millivolts, not state of charge. Interpolate an estimate.
        private static readonly int[] Voltage = { 3500, 3646, 3717, 3778, 3859, 3989, 4067, 4186 };
        private static readonly int[] Capacity = { 0, 5, 20, 40, 60, 80, 90, 100 };
        public FeatureAddress Feature;
        public int Percentage;
        public int LevelCode;
        public int? NextLevel;
        public int StatusCode;
        public string RawResponse;

        public static BatteryInformation ParseBatteryVoltage(byte[] response, FeatureAddress feature)
        {
            if (response == null || response.Length < 7)
                throw new InvalidDataException("Battery Voltage response is too short.");
            int mv = (response[4] << 8) | response[5], flags = response[6];
            if (mv < 3000 || mv > 4500) throw new InvalidDataException("Battery voltage is outside the supported cell range.");
            int status = 0;
            if ((flags & 0x80) != 0)
            {
                switch (flags & 7)
                {
                    case 0: status = 1; break;
                    case 1: status = 3; break;
                    case 2: status = 8; break; // external power, not charging
                    default: status = 255; break;
                }
            }
            return new BatteryInformation
            {
                Feature = feature, Percentage = status == 3 ? 100 : EstimateCapacity(mv),
                LevelCode = (flags & 0x20) != 0 ? 1 : 0, StatusCode = status, RawResponse = Hex.Spaced(response)
            };
        }

        private static int EstimateCapacity(int mv)
        {
            if (mv <= Voltage[0]) return 0;
            for (int high = 1; high < Voltage.Length; high++)
            {
                if (mv > Voltage[high]) continue;
                int low = high - 1, delta = Voltage[high] - Voltage[low];
                return Capacity[low] + ((mv - Voltage[low]) * (Capacity[high] - Capacity[low]) + delta / 2) / delta;
            }
            return 100;
        }

        public static BatteryInformation ParseUnifiedBattery(
            byte[] response,
            FeatureAddress feature)
        {
            if (response == null || response.Length < 7)
            {
                throw new InvalidDataException("Unified Battery response is too short.");
            }
            return new BatteryInformation
            {
                Feature = feature,
                Percentage = response[4],
                LevelCode = response[5],
                StatusCode = response[6],
                RawResponse = Hex.Spaced(response)
            };
        }

        public static BatteryInformation ParseBatteryStatus(
            byte[] response,
            FeatureAddress feature)
        {
            if (response == null || response.Length < 7)
            {
                throw new InvalidDataException("Battery Status response is too short.");
            }
            int percentage = response[4];
            if (percentage < 1 || percentage > 100)
            {
                throw new InvalidDataException("Battery Status percentage is invalid.");
            }
            return new BatteryInformation
            {
                Feature = feature,
                Percentage = percentage,
                LevelCode = 0,
                NextLevel = response[5] == 0 ? (int?)null : response[5],
                StatusCode = response[6],
                RawResponse = Hex.Spaced(response)
            };
        }

        public string LevelName
        {
            get
            {
                switch (LevelCode)
                {
                    case 1: return "critical";
                    case 2: return "low";
                    case 4: return "good";
                    case 8: return "full";
                    default: return "unknown";
                }
            }
        }

        public string StatusName
        {
            get
            {
                switch (StatusCode)
                {
                    case 0: return "discharging";
                    case 1: return "charging";
                    case 2: return "charging-nearly-full";
                    case 3: return "full";
                    case 4: return "charging-slow";
                    case 5: return "invalid-battery";
                    case 6: return "thermal-error";
                    case 7: return "charging-error";
                    case 8: return "not-charging";
                    default: return "unknown";
                }
            }
        }
    }

    internal static class JsonResult
    {
        public static string Build(
            int vendorId,
            int receiverProductId,
            int modelId,
            int batteryFeatureId,
            int slot,
            DeviceInformation device,
            BatteryInformation battery)
        {
            string name = modelId == 0xB042
                ? "MX Master 4"
                : modelId == 0x4074
                    ? "G305 Lightspeed Wireless Gaming Mouse"
                    : modelId == 0x407F ? "G502 LIGHTSPEED Wireless Gaming Mouse" : null;
            string transport = receiverProductId == 0xC53F || receiverProductId == 0xC539
                ? "lightspeed"
                : receiverProductId == 0xC548
                    ? "logi-bolt"
                    : "receiver";
            StringBuilder json = new StringBuilder();
            json.Append('{');
            String(json, "source", "logitech-hidpp-2.0");
            json.Append(',');
            String(json, "transport", transport);
            json.Append(",\"receiver\":{");
            String(json, "vendorId", string.Format(CultureInfo.InvariantCulture, "0x{0:X4}", vendorId));
            json.Append(',');
            String(json, "productId", string.Format(CultureInfo.InvariantCulture, "0x{0:X4}", receiverProductId));
            json.Append("},\"device\":{");
            StringOrNull(json, "name", name);
            json.Append(',');
            String(json, "modelId", string.Format(CultureInfo.InvariantCulture, "0x{0:X4}", modelId));
            json.Append(",\"slot\":").Append(slot);
            json.Append(',');
            String(json, "unitId", device.UnitId);
            json.Append(",\"transportFlags\":").Append(device.TransportFlags);
            json.Append(",\"modelIds\":[");
            for (int index = 0; index < device.ModelIds.Length; index++)
            {
                if (index > 0) { json.Append(','); }
                json.Append(device.ModelIds[index]);
            }
            json.Append(']');
            json.Append(",\"extendedModelId\":").Append(device.ExtendedModelId);
            json.Append("},\"battery\":{");
            json.Append("\"percentage\":").Append(battery.Percentage).Append(',');
            String(json, "level", battery.LevelName);
            json.Append(",\"levelCode\":").Append(battery.LevelCode).Append(',');
            String(json, "status", battery.StatusName);
            json.Append(",\"statusCode\":").Append(battery.StatusCode);
            if (battery.NextLevel.HasValue)
            {
                json.Append(",\"nextLevel\":").Append(battery.NextLevel.Value);
            }
            json.Append("},\"protocol\":{");
            String(json, "featureId", string.Format(
                CultureInfo.InvariantCulture,
                "0x{0:X4}",
                batteryFeatureId));
            json.Append(",\"featureIndex\":").Append(battery.Feature.Index);
            json.Append(",\"featureVersion\":").Append(battery.Feature.Version).Append(',');
            String(json, "rawResponse", battery.RawResponse);
            json.Append("}}");
            return json.ToString();
        }

        private static void String(StringBuilder builder, string key, string value)
        {
            builder.Append('\"').Append(Escape(key)).Append("\":\"")
                .Append(Escape(value)).Append('\"');
        }

        private static void StringOrNull(StringBuilder builder, string key, string value)
        {
            builder.Append('\"').Append(Escape(key)).Append("\":");
            if (value == null) { builder.Append("null"); }
            else { builder.Append('\"').Append(Escape(value)).Append('\"'); }
        }

        private static string Escape(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }

    internal static class Hex
    {
        public static string Compact(byte[] bytes, int offset, int count)
        {
            StringBuilder result = new StringBuilder(count * 2);
            for (int index = offset; index < offset + count; index++)
            {
                result.Append(bytes[index].ToString("x2", CultureInfo.InvariantCulture));
            }
            return result.ToString();
        }

        public static string Spaced(byte[] bytes)
        {
            return string.Join(" ", bytes.Select(
                value => value.ToString("X2", CultureInfo.InvariantCulture)).ToArray());
        }
    }

    internal static class ProtocolSelfTest
    {
        public static void Run()
        {
            FeatureAddress deviceFeature = new FeatureAddress(2, 8);
            byte[] deviceResponse = new byte[20];
            deviceResponse[0] = 0x11;
            deviceResponse[5] = 0xA1;
            deviceResponse[6] = 0xB2;
            deviceResponse[7] = 0xC3;
            deviceResponse[8] = 0xD4;
            deviceResponse[10] = 2;
            deviceResponse[11] = 0xB0;
            deviceResponse[12] = 0x42;
            deviceResponse[17] = 1;
            DeviceInformation device = DeviceInformation.Parse(deviceResponse, deviceFeature);
            if (!device.ModelIds.Contains(0xB042) || device.UnitId != "a1b2c3d4")
            {
                throw new InvalidDataException("Device Information parser self-test failed.");
            }

            FeatureAddress batteryFeature = new FeatureAddress(9, 5);
            byte[] batteryResponse = new byte[]
            {
                0x11, 0x02, 0x09, 0x1D, 0x46, 0x08, 0x00,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
            };
            BatteryInformation battery = BatteryInformation.ParseUnifiedBattery(
                batteryResponse,
                batteryFeature);
            if (battery.Percentage != 70 || battery.LevelName != "full" ||
                battery.StatusName != "discharging")
            {
                throw new InvalidDataException("Unified Battery parser self-test failed.");
            }

            FeatureAddress statusFeature = new FeatureAddress(5, 0);
            byte[] statusResponse = new byte[]
            {
                0x10, 0x01, 0x05, 0x0D, 0x5A, 0x32, 0x00
            };
            BatteryInformation status = BatteryInformation.ParseBatteryStatus(
                statusResponse,
                statusFeature);
            if (status.Percentage != 90 || status.NextLevel != 50 ||
                status.StatusName != "discharging")
            {
                throw new InvalidDataException("Battery Status parser self-test failed.");
            }

            var voltageResponse = new byte[] { 0x10, 1, 5, 0x0D, 0x0F, 0xE3, 0x80 }; // 4067 mV
            var voltage = BatteryInformation.ParseBatteryVoltage(voltageResponse, statusFeature);
            voltageResponse[6] = 0x82;
            var plugged = BatteryInformation.ParseBatteryVoltage(voltageResponse, statusFeature);
            if (voltage.Percentage != 90 || voltage.StatusName != "charging" || plugged.StatusName != "not-charging")
                throw new InvalidDataException("Battery Voltage parser self-test failed.");

            byte[] keychronResponse = new byte[]
            {
                0x54, 0xE3, 0x00, 0x02, 0x02, 0x57, 0x00,
                0x08, 0x30, 0x2E, 0x31, 0x2E, 0x35, 0x2D, 0x33
            };
            KeychronBatteryInformation keychronBattery;
            if (!KeychronRfProtocol.MatchesVerifiedM6Monitor(keychronResponse) ||
                !KeychronRfProtocol.TryParseBattery(keychronResponse, out keychronBattery) ||
                keychronBattery.Percentage != 87 || keychronBattery.Charging)
            {
                throw new InvalidDataException("Keychron RF battery parser self-test failed.");
            }
            keychronResponse[14] = 0x34;
            if (KeychronRfProtocol.MatchesVerifiedM6Monitor(keychronResponse))
                throw new InvalidDataException("Keychron legacy monitor accepted an unverified firmware marker.");
        }
    }

    internal sealed class HidppTimeoutException : TimeoutException
    {
        public HidppTimeoutException(string message) : base(message) { }
    }

    internal sealed class DeviceNotFoundException : Exception
    {
        public DeviceNotFoundException(string message) : base(message) { }
    }
}
