using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text.Json.Nodes;
using Eventa;
using Godot;

/// <summary>
/// Dahlia's screenshots of this PC for the "dahlia:screen" channel: a screenshot of one
/// window (through the window helper, which copies the window's frame from the screen so
/// GPU-drawn games read fine) or of a whole screen (through GDI, the DXGI desktop
/// duplication equivalent Electron's Chromium capture used). A port of Electron's
/// src/main/dahlia-screen-capture.ts.
///
/// Differences from Electron:
/// - There is no Chromium desktop capturer in the Kirie webview, so the host records
///   itself: "record-source" starts a ScreenRecorderLib recording (a window through
///   Windows Graphics Capture, a screen through DXGI desktop duplication, H.264 at
///   30 fps and 8 Mbps, the OBS method) and "record-done" stops it into Videos\Dahlia.
///   The renderer port (dahlia-screen-recorder.ts) drives those two ops.
/// - "save-recording" and "save-picture" still store files in Videos\Dahlia and
///   Pictures\Dahlia. Pictures keep their .png extension (Electron's copy mapped every
///   non-mp4 extension to .webm by mistake).
/// </summary>
internal sealed class DahliaScreenCaptureService : IDisposable
{
    public const int DefaultMaxHeight = 1080;

    /// <summary>A minute of 1080p at the recorder's bitrate is about 60 MB; anything far bigger isn't a recording of hers.</summary>
    public const long MaxRecordingBytes = 400L * 1024 * 1024;
    public const long MaxPictureBytes = 30L * 1024 * 1024;

    /// <summary>The host recorder's picture: H.264 (Media Foundation, like OBS) at 30 fps.</summary>
    public const int RecordingFps = 30;
    /// <summary>The host recorder's bitrate: 8 Mbps, the same as Electron's MediaRecorder path.</summary>
    public const int RecordingBitsPerSecond = 8_000_000;
    /// <summary>How long "record-done" waits for the encoder to finish its file.</summary>
    public static readonly TimeSpan RecordingStopTimeout = TimeSpan.FromSeconds(20);

    internal const string AlreadyRecordingError = "A recording is already running.";
    internal const string NoRecordingError = "No recording is running.";

    private readonly Func<DahliaWindowHelper> _helpers;
    private readonly IDisposable _registration;
    private readonly Func<JsonObject, CancellationToken, Task<JsonObject>>? _windowCall;
    private readonly Func<bool> _isWindows;
    private readonly string? _videosFolder;
    private readonly object _recordGate = new();
    private IDahliaScreenRecorderFactory? _recorderFactory;
    private IDahliaScreenRecording? _recording;
    private string _recordingTitle = string.Empty;
    private string _recordingTempPath = string.Empty;
    private DateTime _recordingStartedAt;
    private bool _disposed;

    public DahliaScreenCaptureService(Func<DahliaWindowHelper> helpers, IDisposable registration)
        : this(helpers, registration, null, null, null, null)
    {
    }

    internal DahliaScreenCaptureService(
        Func<DahliaWindowHelper> helpers,
        IDisposable registration,
        IDahliaScreenRecorderFactory? recorderFactory,
        Func<JsonObject, CancellationToken, Task<JsonObject>>? windowCall,
        Func<bool>? isWindows,
        string? videosFolder)
    {
        _helpers = helpers;
        _registration = registration;
        _recorderFactory = recorderFactory;
        _windowCall = windowCall;
        _isWindows = isWindows ?? OperatingSystem.IsWindows;
        _videosFolder = videosFolder;
    }

    /// <summary>
    /// The Windows check as a platform guard (tests override it to run the recording
    /// routing without Windows): past this, the analyzer treats the capture path as
    /// Windows-only, the same as the OperatingSystem.IsWindows check it replaces.
    /// </summary>
    [SupportedOSPlatformGuard("windows")]
    private bool IsWindows() => _isWindows();

    /// <summary>A file name from a window title: no characters Windows forbids, not too long.</summary>
    public static string RecordingFileName(string title, string extension, DateTime at)
    {
        // Like Electron's recordingFileName: each run of forbidden or control characters
        // becomes one space, then whitespace runs collapse.
        var name = System.Text.RegularExpressions.Regex.Replace(title, "[<>:\"/\\\\|?*\x00-\x1F]+", " ");
        name = string.Join(" ", name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (name.Length > 60)
            name = name[..60];
        if (name.Length == 0)
            name = "Screen";
        var stamp = at.ToString("yyyy-MM-dd HH-mm-ss");
        var ext = extension == "mp4" ? "mp4" : extension == "png" ? "png" : "webm";
        return $"Dahlia - {name} - {stamp}.{ext}";
    }

    public static DahliaScreenCaptureService Attach(IEventContext context, Func<DahliaWindowHelper> helpers)
    {
        if (!OperatingSystem.IsWindows())
        {
            return new DahliaScreenCaptureService(helpers, context.RegisterInvokeHandler(
                DahliaEvents.ScreenCall,
                (DahliaHostCallRequest _, CancellationToken _) => Task.FromResult(
                    DahliaContracts.OkError("Screenshots and recordings work only in the Windows app."))));
        }

        DahliaScreenCaptureService? service = null;
        var registration = context.RegisterInvokeHandler(
            DahliaEvents.ScreenCall,
            async (DahliaHostCallRequest payload, CancellationToken cancellationToken) =>
            {
                try
                {
                    var request = JsonNode.Parse(payload.Json) as JsonObject
                        ?? DahliaWindowHelper.ErrorNode("Unknown request.");
                    return DahliaContracts.Answer(await service!.AnswerAsync(request, cancellationToken));
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception error)
                {
                    return DahliaContracts.OkError(error.Message.Length > 0 ? error.Message : "The capture failed.");
                }
            });
        service = new DahliaScreenCaptureService(helpers, registration);
        return service;
    }

    internal async Task<JsonObject> AnswerAsync(JsonObject request, CancellationToken cancellationToken)
    {
        // The handler is only registered on Windows; this keeps any future caller on
        // the Windows-only capture path below. Tests override the check to run the
        // recording routing without Windows.
        if (!IsWindows())
            return DahliaWindowHelper.ErrorNode("Screenshots and recordings work only in the Windows app.");
        var op = request["op"]?.GetValue<string>();
        switch (op)
        {
            case "screenshot":
                return await TakeScreenshotAsync(request, cancellationToken);
            case "record-source":
                return await StartRecordingAsync(request, cancellationToken);
            case "record-done":
                return await StopRecordingAsync(cancellationToken);
            case "save-recording":
            {
                var data = Convert.FromBase64String(request["data"]?.GetValue<string>() ?? string.Empty);
                if (data.Length == 0 || data.Length > MaxRecordingBytes)
                    return DahliaWindowHelper.ErrorNode("The recording is empty or too big.");
                var folder = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.MyVideos), "Dahlia");
                Directory.CreateDirectory(folder);
                var file = Path.Combine(folder, RecordingFileName(DahliaContracts.GetString(request, "title"), DahliaContracts.GetString(request, "extension"), DateTime.Now));
                await File.WriteAllBytesAsync(file, data, cancellationToken);
                return new JsonObject { ["ok"] = true, ["path"] = file, ["bytes"] = data.Length };
            }
            case "save-picture":
            {
                var data = Convert.FromBase64String(request["data"]?.GetValue<string>() ?? string.Empty);
                if (data.Length == 0 || data.Length > MaxPictureBytes)
                    return DahliaWindowHelper.ErrorNode("The picture is empty or too big.");
                var folder = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.MyPictures), "Dahlia");
                Directory.CreateDirectory(folder);
                var file = Path.Combine(folder, RecordingFileName(DahliaContracts.GetString(request, "title"), "png", DateTime.Now));
                await File.WriteAllBytesAsync(file, data, cancellationToken);
                return new JsonObject { ["ok"] = true, ["path"] = file, ["bytes"] = data.Length };
            }
            default:
                return DahliaWindowHelper.ErrorNode("Unknown request.");
        }
    }

    [SupportedOSPlatform("windows")]
    private async Task<JsonObject> TakeScreenshotAsync(JsonObject request, CancellationToken cancellationToken)
    {
        var maxHeight = Math.Min(2160, Math.Max(360, (int)(request["maxHeight"]?.GetValue<long>() ?? DefaultMaxHeight)));
        var title = DahliaContracts.GetString(request, "window").Trim();
        var hwnd = DahliaContracts.GetLong(request, "hwnd");

        // A window: the helper copies its frame from the screen (GPU games read fine),
        // with Windows' OCR words and the 16x16 change-detection thumbnail when asked.
        if (title.Length > 0 || hwnd != 0)
            return await TakeWindowScreenshotAsync(title, hwnd, maxHeight, DahliaContracts.GetBool(request, "ocr"), cancellationToken);

        var number = (int)(request["screen"]?.GetValue<long>() ?? 0);
        return ScreenScreenshot(number, maxHeight);
    }

    internal async Task<(long Hwnd, string Title, string? Error)> ResolveRecordingWindowAsync(string title, long hwnd, CancellationToken cancellationToken)
    {
        // The helper ranks titles the same way the screenshot path does and skips
        // hidden windows; its handle is what the recorder opens.
        if (hwnd == 0 && title.Length > 0)
        {
            var found = await WindowCallAsync(new JsonObject { ["op"] = "find", ["title"] = title, ["anyApp"] = true }, cancellationToken);
            if (found["ok"]?.GetValue<bool>() == true)
            {
                hwnd = found["hwnd"]?.GetValue<long>() ?? 0;
                if (found["title"]?.GetValue<string>() is { Length: > 0 } foundTitle)
                    title = foundTitle;
            }
        }
        if (hwnd == 0)
            return (0, title, title.Length > 0 ? $"No open window has \"{title}\" in its title." : "That window is gone.");
        if (title.Length == 0)
            title = $"window {hwnd}";
        return (hwnd, title, null);
    }

    private Task<JsonObject> WindowCallAsync(JsonObject request, CancellationToken cancellationToken)
    {
        return _windowCall is not null
            ? _windowCall(request, cancellationToken)
            : _helpers().CallAsync(request, cancellationToken);
    }

    [SupportedOSPlatform("windows")]
    private IDahliaScreenRecorderFactory RecorderFactory => _recorderFactory ??= new ScreenRecorderLibRecorderFactory();

    [SupportedOSPlatform("windows")]
    private async Task<JsonObject> StartRecordingAsync(JsonObject request, CancellationToken cancellationToken)
    {
        var windowTitle = DahliaContracts.GetString(request, "window").Trim();
        var hwnd = DahliaContracts.GetLong(request, "hwnd");

        string title;
        Func<string, IDahliaScreenRecording> start;
        if (windowTitle.Length > 0 || hwnd != 0)
        {
            var resolved = await ResolveRecordingWindowAsync(windowTitle, hwnd, cancellationToken);
            if (resolved.Error is not null)
                return DahliaWindowHelper.ErrorNode(resolved.Error);
            title = resolved.Title;
            var handle = resolved.Hwnd;
            start = path => RecorderFactory.StartWindowRecording(handle, path);
        }
        else
        {
            var number = (int)(request["screen"]?.GetValue<long>() ?? 0);
            if (number >= 1)
            {
                var count = RecorderFactory.DisplayCount;
                if (number > count)
                    return DahliaWindowHelper.ErrorNode($"This PC has {count} screen{(count == 1 ? "" : "s")}.");
                var index = number - 1;
                title = $"screen {number}";
                start = path => RecorderFactory.StartDisplayRecording(index, path);
            }
            else
            {
                title = "the main screen";
                start = RecorderFactory.StartMainDisplayRecording;
            }
        }

        var tempPath = Path.Combine(Path.GetTempPath(), $"dahlia-recording-{Guid.NewGuid():N}.mp4");
        IDahliaScreenRecording recording;
        try
        {
            recording = start(tempPath);
        }
        catch (Exception error)
        {
            return DahliaWindowHelper.ErrorNode(string.IsNullOrWhiteSpace(error.Message) ? "The recording couldn't start." : error.Message);
        }

        lock (_recordGate)
        {
            // One recording at a time, like Electron's renderer-side recording flag:
            // a second start refuses instead of stealing or mixing the first.
            if (_recording is not null)
            {
                recording.Dispose();
                try { File.Delete(tempPath); } catch { }
                return DahliaWindowHelper.ErrorNode(AlreadyRecordingError);
            }
            _recording = recording;
            _recordingTitle = title;
            _recordingTempPath = tempPath;
            _recordingStartedAt = DateTime.UtcNow;
        }
        return new JsonObject { ["ok"] = true, ["title"] = title };
    }

    [SupportedOSPlatform("windows")]
    private async Task<JsonObject> StopRecordingAsync(CancellationToken cancellationToken)
    {
        IDahliaScreenRecording recording;
        string title;
        string tempPath;
        DateTime startedAt;
        lock (_recordGate)
        {
            if (_recording is null)
                return DahliaWindowHelper.ErrorNode(NoRecordingError);
            recording = _recording;
            title = _recordingTitle;
            tempPath = _recordingTempPath;
            startedAt = _recordingStartedAt;
            _recording = null;
            _recordingTitle = string.Empty;
            _recordingTempPath = string.Empty;
        }

        using var timeout = new CancellationTokenSource(RecordingStopTimeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        try
        {
            recording.Stop();
            string file;
            try
            {
                file = await recording.WaitForFileAsync(linked.Token);
            }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested)
            {
                return DahliaWindowHelper.ErrorNode("The recording couldn't be saved.");
            }
            var source = file.Length > 0 && File.Exists(file) ? file : tempPath;
            var bytes = File.Exists(source) ? new FileInfo(source).Length : 0;
            if (bytes <= 0)
                return DahliaWindowHelper.ErrorNode("The recording came out empty.");
            if (bytes > MaxRecordingBytes)
                return DahliaWindowHelper.ErrorNode("The recording is empty or too big.");
            var folder = _videosFolder ?? Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.MyVideos), "Dahlia");
            Directory.CreateDirectory(folder);
            var dest = Path.Combine(folder, RecordingFileName(title, "mp4", DateTime.Now));
            File.Move(source, dest, overwrite: true);
            var seconds = Math.Max(1, (int)Math.Round((DateTime.UtcNow - startedAt).TotalSeconds));
            return new JsonObject { ["ok"] = true, ["path"] = dest, ["bytes"] = bytes, ["seconds"] = seconds, ["title"] = title };
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return DahliaWindowHelper.ErrorNode(string.IsNullOrWhiteSpace(error.Message) ? "The recording couldn't be saved." : error.Message);
        }
        finally
        {
            recording.Dispose();
            try
            {
                if (tempPath.Length > 0 && File.Exists(tempPath))
                    File.Delete(tempPath);
            }
            catch
            {
                // Best effort: a leftover temp file sits in the OS temp folder either way.
            }
        }
    }

    internal async Task<JsonObject> TakeWindowScreenshotAsync(string title, long hwnd, int maxHeight, bool ocr, CancellationToken cancellationToken)
    {
        var helper = _helpers();
        if (hwnd == 0 && title.Length > 0)
        {
            var found = await helper.CallAsync(new JsonObject { ["op"] = "find", ["title"] = title, ["anyApp"] = true }, cancellationToken);
            if (found["ok"]?.GetValue<bool>() == true)
                hwnd = found["hwnd"]?.GetValue<long>() ?? 0;
        }
        if (hwnd == 0)
        {
            // Fall back to the helper-agnostic title ranking over the helper's own
            // listing? The helper has no list op, so rank against the foreground only.
            if (title.Length > 0)
                return DahliaWindowHelper.ErrorNode($"No open window has \"{title}\" in its title.");
            return DahliaWindowHelper.ErrorNode("That window is gone.");
        }
        var capture = new JsonObject { ["op"] = "capture", ["hwnd"] = hwnd, ["maxHeight"] = maxHeight };
        if (ocr)
            capture["ocr"] = true;
        var shot = await helper.CallAsync(capture, cancellationToken);
        if (shot["ok"]?.GetValue<bool>() != true)
            return shot;
        var png = shot["png"]?.GetValue<string>() ?? string.Empty;
        if (png.Length == 0)
            return DahliaWindowHelper.ErrorNode("The screenshot came out blank.");
        var answer = new JsonObject
        {
            ["ok"] = true,
            ["image"] = $"data:image/png;base64,{png}",
            ["width"] = shot["width"]?.GetValue<int>() ?? 0,
            ["height"] = shot["height"]?.GetValue<int>() ?? 0,
            ["name"] = shot["title"]?.GetValue<string>() ?? title,
        };
        var words = shot["words"];
        if (words is not null)
            answer["words"] = JsonNode.Parse(words.ToJsonString());
        var sig = shot["sig"]?.GetValue<string>();
        if (!string.IsNullOrEmpty(sig))
            answer["sig"] = sig;
        if (shot["ocrError"]?.GetValue<string>() is { Length: > 0 } ocrError)
            answer["ocrError"] = ocrError;
        return answer;
    }

    [SupportedOSPlatform("windows")]
    internal static JsonObject ScreenScreenshot(int number, int maxHeight)
    {
        Rect2I bounds;
        try
        {
            bounds = number >= 1 ? MonitorBounds(number - 1) : PrimaryMonitorBounds();
        }
        catch (InvalidOperationException error)
        {
            return DahliaWindowHelper.ErrorNode(error.Message);
        }
        var scale = Math.Min(1.0, (double)maxHeight / Math.Max(1, bounds.Size.Y));
        var width = Math.Max(1, (int)Math.Round(bounds.Size.X * scale));
        var height = Math.Max(1, (int)Math.Round(bounds.Size.Y * scale));
        var jpeg = CaptureJpeg(bounds.Position.X, bounds.Position.Y, bounds.Size.X, bounds.Size.Y, width, height);
        return new JsonObject
        {
            ["ok"] = true,
            ["image"] = $"data:image/jpeg;base64,{Convert.ToBase64String(jpeg)}",
            ["width"] = width,
            ["height"] = height,
            ["name"] = number >= 1 ? $"screen {number}" : "the main screen",
        };
    }

    [SupportedOSPlatform("windows")]
    private static List<Rect2I> MonitorRects()
    {
        var rects = new List<Rect2I>();
        if (!EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (hMonitor, _, _, _) =>
        {
            var info = new MonitorInfoEx { Size = Marshal.SizeOf<MonitorInfoEx>() };
            if (GetMonitorInfo(hMonitor, ref info))
                rects.Add(new Rect2I(info.Monitor.Left, info.Monitor.Top, info.Monitor.Right - info.Monitor.Left, info.Monitor.Bottom - info.Monitor.Top));
            return true;
        }, IntPtr.Zero) || rects.Count == 0)
            throw new InvalidOperationException("Windows listed no screens to capture.");
        return rects;
    }

    [SupportedOSPlatform("windows")]
    private static Rect2I PrimaryMonitorBounds()
    {
        var rects = MonitorRects();
        // The primary monitor holds the origin, like Electron's primary display.
        return rects.FirstOrDefault(rect => rect.Position.X <= 0 && rect.Position.Y <= 0 && rect.End.X > 0 && rect.End.Y > 0, rects[0]);
    }

    [SupportedOSPlatform("windows")]
    private static Rect2I MonitorBounds(int index)
    {
        var rects = MonitorRects();
        if (index < 0 || index >= rects.Count)
            throw new InvalidOperationException($"This PC has {rects.Count} screen{(rects.Count == 1 ? "" : "s")}.");
        return rects[index];
    }

    [SupportedOSPlatform("windows")]
    private static byte[] CaptureJpeg(int x, int y, int width, int height, int scaledWidth, int scaledHeight)
    {
        var desktop = GetDC(IntPtr.Zero);
        if (desktop == IntPtr.Zero)
            throw new InvalidOperationException("The screen couldn't be captured.");
        try
        {
            using var bitmap = new System.Drawing.Bitmap(scaledWidth, scaledHeight, System.Drawing.Imaging.PixelFormat.Format24bppRgb);
            using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
            {
                graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                var source = CreateCompatibleDC(desktop);
                if (source == IntPtr.Zero)
                    throw new InvalidOperationException("The screen couldn't be captured.");
                try
                {
                    var dib = CreateCompatibleBitmap(desktop, width, height);
                    if (dib == IntPtr.Zero)
                        throw new InvalidOperationException("The screen couldn't be captured.");
                    try
                    {
                        var previous = SelectObject(source, dib);
                        try
                        {
                            if (!BitBlt(source, 0, 0, width, height, desktop, x, y, 0x00CC0020))
                                throw new InvalidOperationException("The screen couldn't be captured.");
                        }
                        finally
                        {
                            SelectObject(source, previous);
                        }
                        using var full = System.Drawing.Image.FromHbitmap(dib);
                        graphics.DrawImage(full, 0, 0, scaledWidth, scaledHeight);
                    }
                    finally
                    {
                        DeleteObject(dib);
                    }
                }
                finally
                {
                    DeleteDC(source);
                }
            }
            using var stream = new MemoryStream();
            var codec = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
            using var parameters = new System.Drawing.Imaging.EncoderParameters(1);
            parameters.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
            bitmap.Save(stream, codec, parameters);
            return stream.ToArray();
        }
        finally
        {
            ReleaseDC(IntPtr.Zero, desktop);
        }
    }

    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, IntPtr lprcMonitor, IntPtr dwData);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        public int Size;
        public Rect Monitor;
        public Rect WorkArea;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MonitorInfoEx lpmi);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    private static extern bool BitBlt(IntPtr hdcDest, int x, int y, int cx, int cy, IntPtr hdcSrc, int x1, int y1, uint rop);

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        IDahliaScreenRecording? recording;
        string tempPath;
        lock (_recordGate)
        {
            recording = _recording;
            tempPath = _recordingTempPath;
            _recording = null;
            _recordingTempPath = string.Empty;
        }
        if (recording is not null)
        {
            try { recording.Stop(); } catch { }
            recording.Dispose();
            try
            {
                if (tempPath.Length > 0 && File.Exists(tempPath))
                    File.Delete(tempPath);
            }
            catch
            {
                // Best effort: a leftover temp file sits in the OS temp folder either way.
            }
        }
        _registration.Dispose();
    }
}
