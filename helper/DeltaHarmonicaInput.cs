using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Plain user-mode input helper. No game process access, hooks, drivers or elevation.
internal static class DeltaHarmonicaInput
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Input { public uint Type; public InputUnion Data; }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int Dx, Dy;
        public uint MouseData, Flags, Time;
        public IntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey, Scan;
        public uint Flags, Time;
        public IntPtr ExtraInfo;
    }
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    private sealed class Event
    {
        public int Start, Duration, Octave, Sharp;
        public char Key;
    }

    private static readonly object Gate = new object();
    private static volatile bool Cancel;
    private static volatile bool Quit;
    private static DateTime LastPing = DateTime.UtcNow;
    private static Thread Worker;
    private static char HeldKey = '\0';
    private static int HeldOctave;
    private static bool HeldSharp;
    private static uint ParentPid;

    private static void Status(string value)
    {
        lock (Gate) { Console.WriteLine(value); Console.Out.Flush(); }
    }

    private static Input KeyInput(char key, bool down)
    {
        ushort scan;
        switch (key)
        {
            case 'Z': scan = 0x2C; break;
            case 'X': scan = 0x2D; break;
            case 'C': scan = 0x2E; break;
            case 'V': scan = 0x2F; break;
            case 'B': scan = 0x30; break;
            case 'N': scan = 0x31; break;
            case 'M': scan = 0x32; break;
            case ',': scan = 0x33; break;
            default: throw new ArgumentException("Unsupported key");
        }
        return new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { Scan = scan, Flags = down ? 0x0008u : 0x000Au } } };
    }

    private static Input MouseButton(uint flag)
    {
        return new Input { Type = 0, Data = new InputUnion { Mouse = new MouseInput { Flags = flag } } };
    }

    private static void Send(Input input)
    {
        if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) != 1)
            throw new InvalidOperationException("Windows 拒绝了模拟输入；可能受到权限或系统限制。");
    }

    private static void SendKey(char key, bool down)
    {
        Send(KeyInput(key, down));
    }

    private static void SendMouse(uint flag)
    {
        Send(MouseButton(flag));
    }

    private static void ReleaseAll()
    {
        lock (Gate)
        {
            // Release even if the previous send reported failure; this is the safest cleanup path.
            try { if (HeldKey != '\0') SendKey(HeldKey, false); } catch { }
            try { if (HeldSharp) { HeldSharp = false; SendMouse(0x0040); } } catch { }
            try { if (HeldOctave == -1) { HeldOctave = 0; SendMouse(0x0004); } } catch { }
            try { if (HeldOctave == 1) { HeldOctave = 0; SendMouse(0x0010); } } catch { }
            HeldKey = '\0'; HeldSharp = false; HeldOctave = 0;
        }
    }

    private static void Stop()
    {
        Cancel = true;
        ReleaseAll();
        Status("STOPPED");
    }

    private static List<Event> Parse(string encoded)
    {
        var text = Encoding.ASCII.GetString(Convert.FromBase64String(encoded));
        var result = new List<Event>();
        foreach (var row in text.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var fields = row.Split('|');
            if (fields.Length != 5) throw new FormatException("Bad note row");
            var item = new Event {
                Start = int.Parse(fields[0], CultureInfo.InvariantCulture),
                Duration = int.Parse(fields[1], CultureInfo.InvariantCulture),
                Key = fields[2][0],
                Octave = int.Parse(fields[3], CultureInfo.InvariantCulture),
                Sharp = int.Parse(fields[4], CultureInfo.InvariantCulture)
            };
            if (item.Start < 0 || item.Duration < 1 || item.Duration > 60000 ||
                "ZXCVBNM,".IndexOf(item.Key) < 0 || Math.Abs(item.Octave) > 1 || item.Sharp < 0 || item.Sharp > 1)
                throw new FormatException("Invalid note row");
            result.Add(item);
        }
        if (result.Count > 10000) throw new FormatException("Too many notes");
        result.Sort((a, b) => a.Start.CompareTo(b.Start));
        return result;
    }

    private static bool WaitUntil(Stopwatch watch, int targetMs, IntPtr targetWindow)
    {
        while (watch.ElapsedMilliseconds < targetMs)
        {
            if (Cancel || Quit) return false;
            if ((DateTime.UtcNow - LastPing).TotalMilliseconds > 1500) { Status("ERROR\t主程序失联，已停止"); return false; }
            if (GetForegroundWindow() != targetWindow) { Status("ERROR\t前台窗口已变化，已停止"); return false; }
            Thread.Sleep(Math.Min(5, Math.Max(1, targetMs - (int)watch.ElapsedMilliseconds)));
        }
        return !Cancel && !Quit && GetForegroundWindow() == targetWindow;
    }

    private static void Play(List<Event> events, IntPtr targetWindow)
    {
        try
        {
            var watch = Stopwatch.StartNew();
            for (int second = 3; second > 0; second--)
            {
                Status("COUNTDOWN\t" + second);
                if (!WaitUntil(watch, (4 - second) * 1000, targetWindow)) return;
            }
            Status("PLAYING");
            int previousEnd = 0;
            foreach (var item in events)
            {
                int start = Math.Max(item.Start, previousEnd + 40);
                start = Math.Max(start, 40);
                if (!WaitUntil(watch, 3000 + start - 40, targetWindow)) return;
                lock (Gate)
                {
                    if (item.Octave == -1) { HeldOctave = -1; SendMouse(0x0002); }
                    if (item.Octave == 1) { HeldOctave = 1; SendMouse(0x0008); }
                    if (item.Sharp == 1) { HeldSharp = true; SendMouse(0x0020); }
                }
                if (!WaitUntil(watch, 3000 + start, targetWindow)) return;
                lock (Gate) { HeldKey = item.Key; SendKey(item.Key, true); }
                int end = start + Math.Max(45, item.Duration);
                if (!WaitUntil(watch, 3000 + end, targetWindow)) return;
                ReleaseAll();
                previousEnd = end;
            }
            Status("FINISHED");
        }
        catch (Exception ex) { Status("ERROR\t" + ex.Message); }
        finally { ReleaseAll(); }
    }

    private static int Main(string[] args)
    {
        // Electron reads redirected stdout as UTF-8, independent of the Windows console code page.
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length > 0) uint.TryParse(args[0], out ParentPid);
        AppDomain.CurrentDomain.ProcessExit += (sender, exitArgs) => ReleaseAll();
        Status("READY");
        string line;
        while (!Quit && (line = Console.ReadLine()) != null)
        {
            try
            {
                if (line == "PING") LastPing = DateTime.UtcNow;
                else if (line == "STOP") Stop();
                else if (line == "QUIT") { Stop(); Quit = true; }
                else if (line.StartsWith("PLAY\t", StringComparison.Ordinal))
                {
                    Stop();
                    if (Worker != null && Worker.IsAlive) Worker.Join(500);
                    var payload = line.Substring(5);
                    var events = Parse(payload);
                    if (events.Count == 0) { Status("ERROR\t乐谱没有可演奏音符"); continue; }
                    var target = GetForegroundWindow();
                    if (target == IntPtr.Zero) { Status("ERROR\t未找到前台窗口"); continue; }
                    uint foregroundPid;
                    GetWindowThreadProcessId(target, out foregroundPid);
                    if (foregroundPid == ParentPid) { Status("ERROR\t当前前台仍是口琴谱工作台；请先切到游戏口琴界面，再按曲目快捷键"); continue; }
                    Cancel = false;
                    LastPing = DateTime.UtcNow;
                    Worker = new Thread(() => Play(events, target));
                    Worker.IsBackground = true;
                    Worker.Start();
                }
            }
            catch (Exception ex) { ReleaseAll(); Status("ERROR\t" + ex.Message); }
        }
        Stop();
        return 0;
    }
}
