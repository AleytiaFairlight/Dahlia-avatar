# Dahlia: finds a game window on Windows, captures it and taps, drags or presses keys in it, for Dahlia's
# game player (src/main/dahlia-window-helper.ts starts it; src/renderer/dahlia-game-player.ts uses it).
# This file is Dahlia's (AIRI has no such file).
#
# It reads one JSON request per line on stdin and writes one JSON answer per line on stdout:
#   {"id":1,"op":"find","title":"Dark War"}           -> {"id":1,"ok":true,"hwnd":123,"title":"...","width":540,"height":960}
#   {"id":2,"op":"capture","hwnd":123,"maxHeight":1280} -> {"id":2,"ok":true,"png":"<base64>","width":...,"height":...,"sig":"<base64>"}
#                                                         sig: a 16x16 grayscale thumbnail, to tell whether the screen changed
#   {"id":2,"op":"capture","hwnd":123,"maxHeight":1024,"ocr":true} -> also "words":"[{t,x,y,w,h,l},...]": the text Windows'
#                                                         own OCR reads on the capture, boxes 0-1000 across it, l its line;
#                                                         or "ocrError" when Windows can't read it (the capture still comes)
#   {"id":3,"op":"tap","hwnd":123,"x":500,"y":900}     -> positions from 0 to 1000 across the visible window (what a capture shows)
#   {"id":4,"op":"swipe","hwnd":123,"x1":..,"y1":..,"x2":..,"y2":..,"ms":400}
#   {"id":5,"op":"key","hwnd":123,"key":"escape"}
#   {"id":6,"op":"show","hwnd":123}                   -> restores the window and brings it to the front
#   {"id":7,"op":"find","title":"Notepad","anyApp":true} -> any app's window, browsers too (screenshots, recordings)
#   {"id":8,"op":"foreground"}                         -> {"hwnd":...,"title":"..."}: the window in front
#   {"id":9,"op":"frame","hwnd":123}                   -> {"left":..,"top":..,"width":..,"height":..}: the visible window on the screen
#   {"id":10,"op":"peek","hwnd":123,"maxHeight":1024}  -> {"inFront":true,"jpeg":"<base64>",...}: a capture only while the window is
#                                                         already in front (never brings it there), for watching Aleytia play
#   {"id":11,"op":"watch-events","hwnd":123}           -> {"events":"[[x1,y1,x2,y2,at,ms],...]"}: her own clicks and drags in the window
#                                                         since the last call, 0-1000 across it like taps (starts the mouse hook)
#   {"id":12,"op":"watch-stop"}                        -> stops the mouse hook
# All coordinates are physical pixels (the process is DPI aware), so scaled displays work.

$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class DahliaWindow
{
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }

    [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    delegate IntPtr LowLevelMouseProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool on);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int hookId, LowLevelMouseProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG message, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint threadId, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetWindowRect(IntPtr hwnd, int attribute, out RECT value, int size);

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_MOVE = 0x0001, MOUSEEVENTF_ABSOLUTE = 0x8000, MOUSEEVENTF_VIRTUALDESK = 0x4000;
    const int SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77, SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint PW_RENDERFULLCONTENT = 2;
    const int DWMWA_CLOAKED = 14;
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    /// <summary>Apps whose titles name what they show (a web page, a folder, a chat), never a game.</summary>
    static readonly HashSet<string> NotGames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "chrome", "msedge", "firefox", "opera", "opera_gx", "brave", "vivaldi", "iexplore", "arc", "zen",
        "floorp", "librewolf", "waterfox", "chromium", "thorium", "yandex", "browser",
        "explorer", "discord", "slack", "telegram", "code", "notepad", "notepad++", "obs64", "obs32",
        "dahlia", "electron",
    };

    public static void Init()
    {
        // Per-monitor DPI aware (v2): window rectangles and the cursor are in physical pixels.
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch { }
        try { SetProcessDPIAware(); } catch { }
    }

    static string ProcessName(IntPtr hwnd)
    {
        uint id;
        GetWindowThreadProcessId(hwnd, out id);
        try { using (var process = Process.GetProcessById((int)id)) return process.ProcessName; }
        catch { return ""; }
    }

    static bool IsCloaked(IntPtr hwnd)
    {
        int cloaked;
        try { return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0; }
        catch { return false; }
    }

    /// <summary>The letters and digits of a title, in lower case: "Dark War: Survival" and "DarkWar" compare as "darkwar...".</summary>
    static string TitleKey(string text)
    {
        var key = new StringBuilder(text.Length);
        foreach (var c in text)
            if (char.IsLetterOrDigit(c))
                key.Append(char.ToLowerInvariant(c));
        return key.ToString();
    }

    /// <summary>
    /// How well a window's title matches the text, by their letters and digits only, so case, spaces and
    /// punctuation don't matter: 4 is the very same title (ignoring case only), 3 is the text, 2 starts with it, 1 contains it, 0 is the start of the text (at
    /// least 4 letters); -1 doesn't match. The last is for a short title: she calls the game "Dark War Survival"
    /// while its launcher is titled "Dark War" and its window "DarkWar", and only a Dark War Survival guide in
    /// Chrome contained her words. The very same title comes first because the launcher and the game compare
    /// alike without their spaces: "Dark War" is the launcher, "DarkWar" the game.
    /// </summary>
    public static int MatchRank(string windowTitle, string search)
    {
        var windowKey = TitleKey(windowTitle);
        var key = TitleKey(search);
        if (windowKey.Length == 0 || key.Length == 0)
            return -1;
        if (string.Equals(windowTitle.Trim(), search.Trim(), StringComparison.OrdinalIgnoreCase))
            return 4;
        if (windowKey == key)
            return 3;
        if (windowKey.StartsWith(key))
            return 2;
        if (windowKey.Contains(key))
            return 1;
        if (windowKey.Length >= 4 && key.StartsWith(windowKey))
            return 0;
        return -1;
    }

    /// <summary>
    /// The best of the windows for the text, or -1. A real app wins over a browser's, a folder's or a chat app's
    /// window, so a guide open in Chrome is never taken for the game; then the better match (MatchRank); then the
    /// largest. For the game player (anyApp false) a browser, folder or chat window is dropped outright; for
    /// screenshots (anyApp true) it is only the last resort, when nothing else matches, so a plain screenshot of
    /// a browser window still works.
    /// </summary>
    public static int Pick(string search, bool anyApp, IList<string> titles, IList<string> processes, IList<long> areas)
    {
        var best = -1;
        var bestTier = -1;
        var bestRank = -1;
        var bestArea = 0L;
        for (var i = 0; i < titles.Count; i++)
        {
            var rank = MatchRank(titles[i], search);
            if (rank < 0)
                continue;
            var notGame = NotGames.Contains(processes[i]);
            if (!anyApp && notGame)
                continue;
            var tier = notGame ? 0 : 1;
            if (tier > bestTier
                || (tier == bestTier && rank > bestRank)
                || (tier == bestTier && rank == bestRank && areas[i] > bestArea))
            {
                best = i;
                bestTier = tier;
                bestRank = rank;
                bestArea = areas[i];
            }
        }
        return best;
    }

    /// <summary>The game's window, or another app's for a screenshot: the visible window Pick chooses for the text.</summary>
    public static long Find(string titlePart, bool anyApp, out string title, out string process)
    {
        var handles = new List<IntPtr>();
        var titles = new List<string>();
        var processes = new List<string>();
        var areas = new List<long>();
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd) || IsCloaked(hwnd))
                return true;
            var text = new StringBuilder(512);
            GetWindowText(hwnd, text, text.Capacity);
            var t = text.ToString();
            if (MatchRank(t, titlePart) < 0)
                return true;
            RECT r;
            GetWindowRect(hwnd, out r);
            handles.Add(hwnd);
            titles.Add(t);
            processes.Add(ProcessName(hwnd));
            areas.Add((long)(r.Right - r.Left) * (r.Bottom - r.Top));
            return true;
        }, IntPtr.Zero);
        var index = Pick(titlePart, anyApp, titles, processes, areas);
        title = index < 0 ? "" : titles[index];
        process = index < 0 ? "" : processes[index];
        return index < 0 ? 0 : handles[index].ToInt64();
    }

    /// <summary>The window in front, and its title.</summary>
    public static long ForegroundWindow(out string title)
    {
        var handle = GetForegroundWindow();
        var text = new StringBuilder(512);
        GetWindowText(handle, text, text.Capacity);
        title = text.ToString();
        return handle.ToInt64();
    }

    /// <summary>The program of the window in front, as its process is named; "" when it can't be told.</summary>
    public static string ForegroundProcess()
    {
        return ProcessName(GetForegroundWindow());
    }

    /// <summary>Restores the window and brings it to the front, so the player can watch her play.</summary>
    public static void Show(long hwnd)
    {
        var handle = Handle(hwnd);
        ShowWindow(handle, 5);
        Foreground(handle);
    }

    /// <summary>
    /// SetForegroundWindow from a background process is refused unless its input is joined to the
    /// foreground window's thread first.
    /// </summary>
    static void Foreground(IntPtr handle)
    {
        var current = GetForegroundWindow();
        if (current == handle)
            return;
        uint ignored;
        var foregroundThread = GetWindowThreadProcessId(current, out ignored);
        var thisThread = GetCurrentThreadId();
        var joined = foregroundThread != 0 && foregroundThread != thisThread && AttachThreadInput(thisThread, foregroundThread, true);
        try
        {
            BringWindowToTop(handle);
            SetForegroundWindow(handle);
        }
        finally
        {
            if (joined)
                AttachThreadInput(thisThread, foregroundThread, false);
        }
    }

    static IntPtr Handle(long hwnd)
    {
        var handle = new IntPtr(hwnd);
        if (!IsWindow(handle))
            throw new InvalidOperationException("The game window is gone. Is the game still open?");
        if (IsIconic(handle))
        {
            ShowWindow(handle, 9);
            Thread.Sleep(400);
        }
        return handle;
    }

    /// <summary>The client area on the screen: left, top, width, height.</summary>
    public static int[] Client(long hwnd)
    {
        var handle = Handle(hwnd);
        RECT r;
        GetClientRect(handle, out r);
        var origin = new POINT();
        ClientToScreen(handle, ref origin);
        return new[] { origin.X, origin.Y, r.Right - r.Left, r.Bottom - r.Top };
    }

    /// <summary>
    /// The window as a PNG, at most maxHeight pixels high. A GPU game (DirectX, Unity, such as Dark War) draws
    /// on a surface that PrintWindow and per-window Windows Graphics Capture both return black for, but it
    /// composites to the desktop like any other window, so the window is brought to the front and its pixels are
    /// taken from the screen (this reads the game on a real PC, where the two window-capture methods gave black).
    /// The captured rectangle is the window's visible frame, the same one taps are measured against (Frame /
    /// ToScreen), so a 0-1000 point lands where it is in the picture.
    /// </summary>
    public static string Capture(long hwnd, int maxHeight, out int width, out int height)
    {
        var handle = Handle(hwnd);
        Foreground(handle);
        Thread.Sleep(250);
        return Grab(hwnd, maxHeight, ImageFormat.Png, out width, out height);
    }

    /// <summary>
    /// A capture for watching Aleytia play: the same picture as Capture, as a JPEG, but only while the window
    /// is already in front. It never brings the window forward, so switching to another window while she
    /// is being watched is left alone; then it returns "".
    /// </summary>
    public static string Peek(long hwnd, int maxHeight, out int width, out int height)
    {
        // Not Handle(): that restores a minimized window, and watching must not touch it.
        var handle = new IntPtr(hwnd);
        if (!IsWindow(handle))
            throw new InvalidOperationException("The game window is gone. Is the game still open?");
        width = 0;
        height = 0;
        if (GetForegroundWindow() != handle || IsIconic(handle))
            return "";
        return Grab(hwnd, maxHeight, ImageFormat.Jpeg, out width, out height);
    }

    /// <summary>The last capture's 16x16 grayscale thumbnail (base64): two of them tell whether the screen changed.</summary>
    public static string LastSignature = "";

    static string Signature(Bitmap image)
    {
        using (var small = new Bitmap(16, 16, PixelFormat.Format24bppRgb))
        {
            using (var g = Graphics.FromImage(small))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.DrawImage(image, new Rectangle(0, 0, 16, 16), new Rectangle(0, 0, image.Width, image.Height), GraphicsUnit.Pixel);
            }
            var cells = new byte[256];
            for (var y = 0; y < 16; y++)
            {
                for (var x = 0; x < 16; x++)
                {
                    var c = small.GetPixel(x, y);
                    cells[y * 16 + x] = (byte)((c.R * 299 + c.G * 587 + c.B * 114) / 1000);
                }
            }
            return Convert.ToBase64String(cells);
        }
    }

    /// <summary>The visible window, copied from the screen, at most maxHeight pixels high.</summary>
    static string Grab(long hwnd, int maxHeight, ImageFormat format, out int width, out int height)
    {
        var f = Frame(hwnd);
        var frameWidth = f[2];
        var frameHeight = f[3];
        if (frameWidth <= 0 || frameHeight <= 0)
            throw new InvalidOperationException("The game window has no size. Is it minimized?");

        using (var whole = new Bitmap(frameWidth, frameHeight, PixelFormat.Format24bppRgb))
        {
            using (var g = Graphics.FromImage(whole))
                g.CopyFromScreen(f[0], f[1], 0, 0, new Size(frameWidth, frameHeight));

            var scale = Math.Min(1.0, (double)maxHeight / frameHeight);
            width = Math.Max(1, (int)Math.Round(frameWidth * scale));
            height = Math.Max(1, (int)Math.Round(frameHeight * scale));
            using (var output = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(output))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.DrawImage(whole, new Rectangle(0, 0, width, height), new Rectangle(0, 0, frameWidth, frameHeight), GraphicsUnit.Pixel);
                }
                LastSignature = Signature(output);
                using (var stream = new MemoryStream())
                {
                    if (format.Equals(ImageFormat.Jpeg))
                    {
                        var jpeg = Array.Find(ImageCodecInfo.GetImageEncoders(), codec => codec.FormatID == ImageFormat.Jpeg.Guid);
                        var quality = new EncoderParameters(1);
                        quality.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
                        output.Save(stream, jpeg, quality);
                    }
                    else
                    {
                        output.Save(stream, format);
                    }
                    return Convert.ToBase64String(stream.ToArray());
                }
            }
        }
    }

    /// <summary>The visible window on the screen: left, top, width, height. This is what a window capture shows
    /// (Windows Graphics Capture, the screenshot and game tools), title bar included and the invisible resize
    /// border excluded, so a 0-1000 position lands where it does in the picture. Falls back to the window rect.</summary>
    public static int[] Frame(long hwnd)
    {
        var handle = Handle(hwnd);
        RECT r;
        if (DwmGetWindowRect(handle, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) != 0)
            GetWindowRect(handle, out r);
        return new[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }

    static POINT ToScreen(long hwnd, int x, int y)
    {
        // 0-1000 across the visible window, so it matches the window capture she taps from (Frame, not the
        // client area: her screenshots and the game player see the whole window through Windows Graphics Capture).
        var frame = Frame(hwnd);
        x = Math.Max(0, Math.Min(1000, x));
        y = Math.Max(0, Math.Min(1000, y));
        return new POINT { X = frame[0] + (int)Math.Round(frame[2] * x / 1000.0), Y = frame[1] + (int)Math.Round(frame[3] * y / 1000.0) };
    }

    /// <summary>A left button-up or button-down event (no movement).</summary>
    static MOUSEINPUT Button(uint flags)
    {
        return new MOUSEINPUT { dwFlags = flags };
    }

    /// <summary>An absolute move to a screen point, across all monitors (the virtual desktop). Unity games
    /// read the click at the point of this move, so the click is sent as move+down+up together, not as a
    /// SetCursorPos followed by a bare button event, which they ignore.</summary>
    static MOUSEINPUT MoveTo(int screenX, int screenY)
    {
        int vx = GetSystemMetrics(SM_XVIRTUALSCREEN), vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN), vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        return new MOUSEINPUT
        {
            dx = (int)Math.Round((screenX - vx) * 65535.0 / Math.Max(1, vw - 1)),
            dy = (int)Math.Round((screenY - vy) * 65535.0 / Math.Max(1, vh - 1)),
            dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        };
    }

    /// <summary>Sends a run of mouse events as one input batch.</summary>
    static void Send(params MOUSEINPUT[] events)
    {
        var inputs = new INPUT[events.Length];
        for (var i = 0; i < events.Length; i++)
            inputs[i] = new INPUT { type = INPUT_MOUSE, u = new INPUTUNION { mi = events[i] } };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    /// <summary>Brings the game to the front, clicks there and puts the pointer back where it was.</summary>
    public static void Tap(long hwnd, int x, int y)
    {
        var handle = Handle(hwnd);
        var point = ToScreen(hwnd, x, y);
        POINT before;
        GetCursorPos(out before);
        Foreground(handle);
        Thread.Sleep(60);
        SetCursorPos(point.X, point.Y);
        Thread.Sleep(30);
        Send(MoveTo(point.X, point.Y), Button(MOUSEEVENTF_LEFTDOWN), Button(MOUSEEVENTF_LEFTUP));
        Thread.Sleep(30);
        SetCursorPos(before.X, before.Y);
    }

    /// <summary>A drag from one point to another, in steps, like a finger.</summary>
    public static void Swipe(long hwnd, int x1, int y1, int x2, int y2, int ms)
    {
        var handle = Handle(hwnd);
        var from = ToScreen(hwnd, x1, y1);
        var to = ToScreen(hwnd, x2, y2);
        POINT before;
        GetCursorPos(out before);
        Foreground(handle);
        Thread.Sleep(60);
        SetCursorPos(from.X, from.Y);
        Send(MoveTo(from.X, from.Y), Button(MOUSEEVENTF_LEFTDOWN));
        var steps = Math.Max(5, Math.Min(60, ms / 15));
        for (var i = 1; i <= steps; i++)
        {
            int sx = from.X + (to.X - from.X) * i / steps;
            int sy = from.Y + (to.Y - from.Y) * i / steps;
            Send(MoveTo(sx, sy));
            SetCursorPos(sx, sy);
            Thread.Sleep(Math.Max(1, ms / steps));
        }
        Thread.Sleep(80);
        Send(Button(MOUSEEVENTF_LEFTUP));
        Thread.Sleep(30);
        SetCursorPos(before.X, before.Y);
    }

    // Watching Aleytia play: a low-level mouse hook (WH_MOUSE_LL, in this process; nothing goes into the game)
    // notes each left-button press and release. Only her own: clicks this helper sends are marked injected
    // and skipped. Only clicks that land on the game window are handed out (WatchEvents), the rest dropped.
    const int WH_MOUSE_LL = 14, WM_LBUTTONDOWN = 0x0201, WM_LBUTTONUP = 0x0202;
    const uint WM_QUIT = 0x0012, LLMHF_INJECTED = 0x01, GA_ROOT = 2;
    const int MAX_GESTURES = 500;
    static readonly object watchLock = new object();
    static readonly List<long[]> gestures = new List<long[]>();
    static LowLevelMouseProc watchCallback;
    static Thread watchThread;
    static uint watchThreadId;
    static bool pressed;
    static POINT pressedAt;
    static long pressedMs;
    static IntPtr pressedWindow;

    static long NowMs()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
    }

    static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            var message = wParam.ToInt32();
            if ((info.flags & LLMHF_INJECTED) == 0)
            {
                if (message == WM_LBUTTONDOWN)
                {
                    pressed = true;
                    pressedAt = info.pt;
                    pressedMs = NowMs();
                    pressedWindow = GetAncestor(WindowFromPoint(info.pt), GA_ROOT);
                }
                else if (message == WM_LBUTTONUP && pressed)
                {
                    pressed = false;
                    lock (gestures)
                    {
                        if (gestures.Count < MAX_GESTURES)
                            gestures.Add(new long[] { pressedAt.X, pressedAt.Y, info.pt.X, info.pt.Y, pressedMs, NowMs() - pressedMs, pressedWindow.ToInt64() });
                    }
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    /// <summary>Starts the mouse hook on its own thread, which needs a message loop; once.</summary>
    public static void WatchStart()
    {
        lock (watchLock)
        {
            if (watchThread != null)
                return;
            string error = null;
            var ready = new ManualResetEvent(false);
            watchCallback = OnMouse;
            var thread = new Thread(() =>
            {
                watchThreadId = GetCurrentThreadId();
                var hook = SetWindowsHookEx(WH_MOUSE_LL, watchCallback, GetModuleHandle(null), 0);
                if (hook == IntPtr.Zero)
                    error = "Windows refused the mouse hook (error " + Marshal.GetLastWin32Error() + ").";
                ready.Set();
                if (hook == IntPtr.Zero)
                    return;
                MSG message;
                while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
                UnhookWindowsHookEx(hook);
            });
            thread.IsBackground = true;
            thread.Start();
            ready.WaitOne(5000);
            if (error != null)
                throw new InvalidOperationException(error);
            watchThread = thread;
            lock (gestures)
                gestures.Clear();
        }
    }

    public static void WatchStop()
    {
        lock (watchLock)
        {
            if (watchThread == null)
                return;
            PostThreadMessage(watchThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            watchThread.Join(2000);
            watchThread = null;
        }
    }

    /// <summary>
    /// Her clicks and drags on the window since the last call, as JSON [[x1,y1,x2,y2,at,ms],...]: positions 0-1000
    /// across the visible window (as taps use them), the press time (Unix ms) and how long the button was down.
    /// </summary>
    public static string WatchEvents(long hwnd)
    {
        WatchStart();
        var f = Frame(hwnd);
        List<long[]> taken;
        lock (gestures)
        {
            taken = new List<long[]>(gestures);
            gestures.Clear();
        }
        var json = new StringBuilder("[");
        foreach (var g in taken)
        {
            if (g[6] != hwnd || f[2] <= 0 || f[3] <= 0)
                continue;
            if (json.Length > 1)
                json.Append(',');
            json.Append('[').Append(Across(g[0], f[0], f[2])).Append(',').Append(Across(g[1], f[1], f[3])).Append(',')
                .Append(Across(g[2], f[0], f[2])).Append(',').Append(Across(g[3], f[1], f[3])).Append(',')
                .Append(g[4]).Append(',').Append(g[5]).Append(']');
        }
        return json.Append(']').ToString();
    }

    static long Across(long screen, int start, int size)
    {
        return Math.Max(0, Math.Min(1000, (long)Math.Round((screen - start) * 1000.0 / size)));
    }

    public static void Key(long hwnd, string key)
    {
        ushort vk;
        switch (key)
        {
            case "escape": vk = 0x1B; break;
            case "enter": vk = 0x0D; break;
            case "space": vk = 0x20; break;
            default: throw new ArgumentException("Unknown key " + key);
        }
        Foreground(Handle(hwnd));
        Thread.Sleep(60);
        var down = new INPUT { type = INPUT_KEYBOARD };
        down.u.ki.wVk = vk;
        var up = new INPUT { type = INPUT_KEYBOARD };
        up.u.ki.wVk = vk;
        up.u.ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(2, new[] { down, up }, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@

[DahliaWindow]::Init()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Reading a capture's text with Windows' own OCR (Windows.Media.Ocr, part of Windows 10 and 11; nothing to
# install), through Windows PowerShell's WinRT support. It loads on the first capture that asks for it.
$script:ocrEngine = $null
$script:asTask = $null

function Get-DahliaOcr {
    if ($null -eq $script:ocrEngine) {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
        $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
        $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
        $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
        $script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        } | Select-Object -First 1
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
        if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
        if ($null -eq $engine) { throw 'Windows has no OCR language. Add English in Settings > Time & language > Language.' }
        $script:ocrEngine = $engine
    }
    $script:ocrEngine
}

function Wait-DahliaWinRt($operation, [Type]$type) {
    $task = $script:asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    if (-not $task.Wait(15000)) { throw 'Reading the screen took too long.' }
    $task.Result
}

# The words on a capture (its PNG as base64, and its size), as JSON: [{t, x, y, w, h, l}, ...], boxes 0-1000.
function Read-DahliaText([string]$png, [int]$width, [int]$height) {
    $engine = Get-DahliaOcr
    $memory = New-Object System.IO.MemoryStream(, [Convert]::FromBase64String($png))
    $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($memory)
    try {
        $decoder = Wait-DahliaWinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Wait-DahliaWinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Wait-DahliaWinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $words = New-Object System.Collections.ArrayList
        $line = 0
        foreach ($ocrLine in $result.Lines) {
            foreach ($word in $ocrLine.Words) {
                $box = $word.BoundingRect
                $null = $words.Add([ordered]@{
                    t = $word.Text
                    x = [int][Math]::Round($box.X * 1000 / $width)
                    y = [int][Math]::Round($box.Y * 1000 / $height)
                    w = [int][Math]::Round($box.Width * 1000 / $width)
                    h = [int][Math]::Round($box.Height * 1000 / $height)
                    l = $line
                })
            }
            $line++
        }
        $bitmap.Dispose()
        ConvertTo-Json -InputObject @($words) -Compress -Depth 3
    }
    finally {
        $stream.Dispose()
        $memory.Dispose()
    }
}

function Get-DahliaError($record) {
    # A .NET method's exception comes wrapped in "Exception calling ..."; the inner one says what failed.
    $exception = $record.Exception
    if ($null -ne $exception.InnerException) { $exception = $exception.InnerException }
    $exception.Message
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $answer = @{ ok = $true }
    try {
        $request = $line | ConvertFrom-Json
        $answer.id = $request.id
        switch ($request.op) {
            'find' {
                $title = ''; $process = ''
                $anyApp = $request.anyApp -eq $true
                $hwnd = [DahliaWindow]::Find([string]$request.title, $anyApp, [ref]$title, [ref]$process)
                if ($hwnd -eq 0 -and $anyApp) { throw "No open window has `"$($request.title)`" in its title." }
                if ($hwnd -eq 0) { throw "No game window has `"$($request.title)`" in its title (browser windows don't count). Is the game open?" }
                $client = [DahliaWindow]::Client($hwnd)
                $answer.hwnd = $hwnd; $answer.title = $title; $answer.process = $process; $answer.width = $client[2]; $answer.height = $client[3]
            }
            'capture' {
                $width = 0; $height = 0
                $answer.png = [DahliaWindow]::Capture([long]$request.hwnd, [int]$request.maxHeight, [ref]$width, [ref]$height)
                $answer.width = $width; $answer.height = $height
                $answer.sig = [DahliaWindow]::LastSignature
                if ($request.ocr -eq $true) {
                    try { $answer.words = Read-DahliaText $answer.png $width $height }
                    catch { $answer.ocrError = Get-DahliaError $_ }
                }
            }
            'tap' { [DahliaWindow]::Tap([long]$request.hwnd, [int]$request.x, [int]$request.y) }
            'swipe' { [DahliaWindow]::Swipe([long]$request.hwnd, [int]$request.x1, [int]$request.y1, [int]$request.x2, [int]$request.y2, [int]$request.ms) }
            'key' { [DahliaWindow]::Key([long]$request.hwnd, [string]$request.key) }
            'show' { [DahliaWindow]::Show([long]$request.hwnd) }
            'frame' {
                $frame = [DahliaWindow]::Frame([long]$request.hwnd)
                $answer.left = $frame[0]; $answer.top = $frame[1]; $answer.width = $frame[2]; $answer.height = $frame[3]
            }
            'peek' {
                $width = 0; $height = 0
                $jpeg = [DahliaWindow]::Peek([long]$request.hwnd, [int]$request.maxHeight, [ref]$width, [ref]$height)
                $answer.inFront = $jpeg.Length -gt 0
                if ($answer.inFront) { $answer.jpeg = $jpeg; $answer.width = $width; $answer.height = $height }
            }
            'watch-events' { $answer.events = [DahliaWindow]::WatchEvents([long]$request.hwnd) }
            'watch-stop' { [DahliaWindow]::WatchStop() }
            'foreground' {
                $title = ''
                $answer.hwnd = [DahliaWindow]::ForegroundWindow([ref]$title)
                $answer.title = $title
                try { $answer.process = [DahliaWindow]::ForegroundProcess() } catch { $answer.process = '' }
            }
            # The words on a picture the app already has (a capture of the whole screen), for her screen watching.
            'read-text' { $answer.words = Read-DahliaText ([string]$request.image) ([int]$request.width) ([int]$request.height) }
            default { throw "Unknown request $($request.op)" }
        }
    }
    catch {
        $answer.ok = $false
        $answer.error = Get-DahliaError $_
    }
    [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
