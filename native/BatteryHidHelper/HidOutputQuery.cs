using System;
using System.Diagnostics;
using HidSharp;

namespace BatteryFlexBar.Native
{
    internal static class HidOutputQuery
    {
        public static byte[] ReadReply(HidStream stream, byte[] request, int inputLength,
            int minimumLength, Func<byte[], bool> accepts, int timeoutMs)
        {
            var reply = new byte[inputLength];
            stream.ReadTimeout = 5;
            stream.WriteTimeout = timeoutMs;
            // Discard input already queued before the command, within a fixed bound.
            for (int i = 0; i < 16; i++)
            {
                try { stream.Read(reply); }
                catch (TimeoutException) { break; }
            }
            stream.Write(request);
            var timer = Stopwatch.StartNew();
            while (timer.ElapsedMilliseconds < timeoutMs)
            {
                stream.ReadTimeout = (int)Math.Max(1, timeoutMs - timer.ElapsedMilliseconds);
                try
                {
                    int count = stream.Read(reply);
                    if (count >= minimumLength && accepts(reply))
                    {
                        Array.Resize(ref reply, count);
                        return reply;
                    }
                }
                catch (TimeoutException) { break; }
            }
            return null;
        }
    }
}
