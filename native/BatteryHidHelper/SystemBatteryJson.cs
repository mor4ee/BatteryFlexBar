using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace BatteryFlexBar.Native
{
    internal sealed class SystemBatteryReading
    {
        public readonly Guid ContainerId;
        public readonly string Name;
        public readonly int? Percentage;
        public readonly string Transport;
        public readonly bool? Charging;
        public readonly string Kind, Level;
        public readonly int StepPercent;

        public SystemBatteryReading(Guid containerId, string name, int? percentage,
            string transport = null, bool? charging = null, string kind = null, int stepPercent = 0, string level = null)
        {
            ContainerId = containerId;
            Name = name;
            Percentage = percentage;
            Transport = transport;
            Charging = charging;
            Kind = kind;
            StepPercent = stepPercent;
            Level = level;
        }
    }

    internal static class SystemBatteryJson
    {
        public static string Build(string source, IEnumerable<SystemBatteryReading> readings)
        {
            var json = new StringBuilder("{\"source\":");
            AppendString(json, source);
            json.Append(",\"devices\":[");
            bool first = true;
            foreach (var reading in readings.Take(64))
            {
                if (!first) json.Append(',');
                first = false;
                json.Append("{\"containerId\":\"").Append(reading.ContainerId.ToString("D"))
                    .Append("\",\"name\":");
                AppendString(json, reading.Name);
                json.Append(",\"percentage\":").Append(reading.Percentage.HasValue
                    ? reading.Percentage.Value.ToString(CultureInfo.InvariantCulture) : "null");
                if (reading.Kind != null) { json.Append(",\"kind\":"); AppendString(json, reading.Kind); }
                if (reading.Level != null) { json.Append(",\"level\":"); AppendString(json, reading.Level); }
                if (reading.StepPercent > 0)
                    json.Append(",\"stepPercent\":").Append(reading.StepPercent.ToString(CultureInfo.InvariantCulture));
                if (reading.Transport != null)
                {
                    json.Append(",\"transport\":");
                    AppendString(json, reading.Transport);
                    json.Append(",\"charging\":");
                    json.Append(reading.Charging.HasValue ? (reading.Charging.Value ? "true" : "false") : "null");
                }
                json.Append('}');
            }
            return json.Append("]}").ToString();
        }

        private static void AppendString(StringBuilder json, string value)
        {
            json.Append('"');
            int length = Math.Min(value.Length, 128);
            if (length < value.Length && char.IsHighSurrogate(value[length - 1])) length--;
            for (int index = 0; index < length; index++)
            {
                char ch = value[index];
                if (char.IsControl(ch) || char.IsSurrogate(ch))
                    json.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                else if (ch == '"' || ch == '\\')
                    json.Append('\\').Append(ch);
                else
                    json.Append(ch);
            }
            json.Append('"');
        }
    }
}
