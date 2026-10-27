# Dahlia: finds a game window on Windows, captures it and taps, drags or presses keys in it, for Dahlia's
# game player (src/main/dahlia-window-helper.ts starts it; src/renderer/dahlia-game-player.ts uses it).
# This file is Dahlia's (AIRI has no such file).
#
# It reads one JSON request per line on stdin and writes one JSON answer per line on stdout:
#   {"id":1,"op":"find","title":"Dark War"}           -> {"id":1,"ok":true,"hwnd":123,"title":"...","width":540,"height":960}
#   {"id":2,"op":"capture","hwnd":123,"maxHeight":1280} -> {"id":2,"ok":true,"png":"<base64>","width":...,"height":...}
#   {"id":3,"op":"tap","hwnd":123,"x":500,"y":900}     -> positions from 0 to 1000 across the window's client area
#   {"id":4,"op":"swipe","hwnd":123,"x1":..,"y1":..,"x2":..,"y2":..,"ms":400}
#   {"id":5,"op":"key","hwnd":123,"key":"escape"}
#   {"id":6,"op":"show","hwnd":123}                   -> restores the window and brings it to the front
#   {"id":7,"op":"find","title":"Notepad","anyApp":true} -> any app's window, browsers too (screenshots, recordings)
#   {"id":8,"op":"foreground"}                         -> {"hwnd":...,"title":"..."}: the window in front
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

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

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
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool on);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint PW_RENDERFULLCONTENT = 2;
    const int DWMWA_CLOAKED = 14;

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

    /// <summary>
    /// The game's window: a visible window whose title contains the text (any letter case), not a browser's,
    /// a folder's or a chat app's, so a guide open in Chrome is never taken for the game. A title that is
    /// the text wins over one that starts with it, which wins over one that only contains it; then the largest.
    /// </summary>
    public static long Find(string titlePart, bool anyApp, out string title, out string process)
    {
        var best = IntPtr.Zero;
        var bestRank = -1;
        var bestArea = 0L;
        var bestTitle = "";
        var bestProcess = "";
        var part = titlePart.Trim().ToLowerInvariant();
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd) || IsCloaked(hwnd))
                return true;
            var text = new StringBuilder(512);
            GetWindowText(hwnd, text, text.Capacity);
            var t = text.ToString();
            var lower = t.Trim().ToLowerInvariant();
            if (lower.Length == 0 || !lower.Contains(part))
                return true;
            var name = ProcessName(hwnd);
            if (!anyApp && NotGames.Contains(name))
                return true;
            var rank = lower == part ? 2 : lower.StartsWith(part) ? 1 : 0;
            RECT r;
            GetWindowRect(hwnd, out r);
            var area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
            if (rank > bestRank || (rank == bestRank && area > bestArea))
            {
                best = hwnd;
                bestRank = rank;
                bestArea = area;
                bestTitle = t;
                bestProcess = name;
            }
            return true;
        }, IntPtr.Zero);
        title = bestTitle;
        process = bestProcess;
        return best.ToInt64();
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

    /// <summary>The client area as a PNG, at most maxHeight pixels high. Works while other windows cover it.</summary>
    public static string Capture(long hwnd, int maxHeight, out int width, out int height)
    {
        var handle = Handle(hwnd);
        var client = Client(hwnd);
        RECT w;
        GetWindowRect(handle, out w);
        var windowWidth = w.Right - w.Left;
        var windowHeight = w.Bottom - w.Top;
        if (client[2] <= 0 || client[3] <= 0 || windowWidth <= 0 || windowHeight <= 0)
            throw new InvalidOperationException("The game window has no size. Is it minimized?");

        using (var whole = new Bitmap(windowWidth, windowHeight, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(whole))
            {
                var hdc = g.GetHdc();
                var printed = PrintWindow(handle, hdc, PW_RENDERFULLCONTENT);
                g.ReleaseHdc(hdc);
                if (!printed || IsBlank(whole))
                {
                    // Some games draw where PrintWindow can't see; take the screen there instead (it must be visible).
                    g.CopyFromScreen(w.Left, w.Top, 0, 0, new Size(windowWidth, windowHeight));
                }
            }

            var crop = new Rectangle(client[0] - w.Left, client[1] - w.Top, client[2], client[3]);
            crop.Intersect(new Rectangle(0, 0, windowWidth, windowHeight));
            var scale = Math.Min(1.0, (double)maxHeight / crop.Height);
            width = Math.Max(1, (int)Math.Round(crop.Width * scale));
            height = Math.Max(1, (int)Math.Round(crop.Height * scale));
            using (var output = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(output))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.DrawImage(whole, new Rectangle(0, 0, width, height), crop, GraphicsUnit.Pixel);
                }
                using (var stream = new MemoryStream())
                {
                    output.Save(stream, ImageFormat.Png);
                    return Convert.ToBase64String(stream.ToArray());
                }
            }
        }
    }

    static bool IsBlank(Bitmap bitmap)
    {
        var first = bitmap.GetPixel(bitmap.Width / 2, bitmap.Height / 2);
        for (var i = 1; i <= 8; i++)
        {
            var p = bitmap.GetPixel(bitmap.Width * i / 9, bitmap.Height * ((i * 5) % 9 + 1) / 10);
            if (p.ToArgb() != first.ToArgb())
                return false;
        }
        return true;
    }

    static POINT ToScreen(long hwnd, int x, int y)
    {
        var client = Client(hwnd);
        x = Math.Max(0, Math.Min(1000, x));
        y = Math.Max(0, Math.Min(1000, y));
        return new POINT { X = client[0] + (int)Math.Round(client[2] * x / 1000.0), Y = client[1] + (int)Math.Round(client[3] * y / 1000.0) };
    }

    static void Mouse(uint flags)
    {
        var input = new INPUT { type = INPUT_MOUSE };
        input.u.mi.dwFlags = flags;
        SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
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
        Mouse(MOUSEEVENTF_LEFTDOWN);
        Thread.Sleep(60);
        Mouse(MOUSEEVENTF_LEFTUP);
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
        Thread.Sleep(30);
        Mouse(MOUSEEVENTF_LEFTDOWN);
        var steps = Math.Max(5, Math.Min(60, ms / 15));
        for (var i = 1; i <= steps; i++)
        {
            SetCursorPos(from.X + (to.X - from.X) * i / steps, from.Y + (to.Y - from.Y) * i / steps);
            Thread.Sleep(Math.Max(1, ms / steps));
        }
        Thread.Sleep(80);
        Mouse(MOUSEEVENTF_LEFTUP);
        Thread.Sleep(30);
        SetCursorPos(before.X, before.Y);
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
            }
            'tap' { [DahliaWindow]::Tap([long]$request.hwnd, [int]$request.x, [int]$request.y) }
            'swipe' { [DahliaWindow]::Swipe([long]$request.hwnd, [int]$request.x1, [int]$request.y1, [int]$request.x2, [int]$request.y2, [int]$request.ms) }
            'key' { [DahliaWindow]::Key([long]$request.hwnd, [string]$request.key) }
            'show' { [DahliaWindow]::Show([long]$request.hwnd) }
            'foreground' {
                $title = ''
                $answer.hwnd = [DahliaWindow]::ForegroundWindow([ref]$title)
                $answer.title = $title
            }
            default { throw "Unknown request $($request.op)" }
        }
    }
    catch {
        # A .NET method's exception comes wrapped in "Exception calling ..."; the inner one says what failed.
        $exception = $_.Exception
        if ($null -ne $exception.InnerException) { $exception = $exception.InnerException }
        $answer.ok = $false
        $answer.error = $exception.Message
    }
    [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
