using System.Diagnostics;
using System.Text.Json.Nodes;
using Eventa;
using Godot;

/// <summary>
/// Dahlia's window helper: runs resources/dahlia-window-helper.ps1, which finds, captures
/// and taps a game window on Windows, and answers the renderer's window calls on the
/// "dahlia:window" channel for her game player. A port of Electron's
/// src/main/dahlia-window-helper.ts (protocol, timeouts and guard behavior kept).
///
/// The helper reads one JSON request per line on stdin and writes one JSON answer per
/// line on stdout: {"id","op",...} -> {"id","ok",...}. See the .ps1 header for the ops.
/// </summary>
internal sealed class DahliaWindowHelper : IDisposable
{
    /// <summary>A capture of a large window can take a few seconds; anything longer means the helper is stuck.</summary>
    public static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(20);

    private static readonly HashSet<string> Ops = new(StringComparer.Ordinal)
    {
        "find", "capture", "tap", "swipe", "key", "show", "foreground",
        "read-text", "frame", "peek", "watch-events", "watch-stop", "system",
    };

    private readonly Func<Process> _start;
    private readonly object _gate = new();
    private Process? _child;
    private Task? _reader;
    private int _nextId = 1;
    private readonly Dictionary<int, TaskCompletionSource<string>> _pending = new();
    private bool _disposed;

    public DahliaWindowHelper(Func<Process> start)
    {
        _start = start;
    }

    /// <summary>How well a window title fits the text asked for: 2 the same, 1 starts with it, 0 contains it, -1 not.</summary>
    public static int TitleRank(string title, string part)
    {
        var t = title.Trim().ToLowerInvariant();
        var p = part.Trim().ToLowerInvariant();
        if (t.Length == 0 || p.Length == 0 || !t.Contains(p, StringComparison.Ordinal))
            return -1;
        return t == p ? 2 : t.StartsWith(p, StringComparison.Ordinal) ? 1 : 0;
    }

    /// <summary>
    /// The best window name for the title: by rank, then the order Windows lists them
    /// (front first). Names of Dahlia's own windows never match. A port of Electron's
    /// pickWindowSource, over names so it stays testable without a capture source.
    /// </summary>
    public static string? PickWindowName(IReadOnlyList<string> names, string title, IReadOnlySet<string> ownNames)
    {
        string? best = null;
        var bestRank = -1;
        foreach (var name in names)
        {
            if (ownNames.Contains(name))
                continue;
            var rank = TitleRank(name, title);
            if (rank > bestRank)
            {
                best = name;
                bestRank = rank;
            }
        }
        return bestRank >= 0 ? best : null;
    }

    public async Task<JsonObject> CallAsync(JsonObject request, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var op = request["op"]?.GetValue<string>();
        if (string.IsNullOrEmpty(op) || !Ops.Contains(op))
            return ErrorNode("Unknown request.");

        int id;
        TaskCompletionSource<string> waiting;
        lock (_gate)
        {
            id = _nextId++;
            waiting = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            _pending[id] = waiting;
            EnsureLocked();
        }

        request["id"] = id;
        try
        {
            Process child;
            lock (_gate)
                child = _child!;
            await child.StandardInput.WriteLineAsync(request.ToJsonString()).WaitAsync(RequestTimeout, cancellationToken);
        }
        catch (Exception error) when (error is TimeoutException or OperationCanceledException or IOException or InvalidOperationException)
        {
            Settle(id, ErrorNode("The window helper didn't answer.").ToJsonString());
        }

        using var timeout = new CancellationTokenSource(RequestTimeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        try
        {
            var line = await waiting.Task.WaitAsync(linked.Token);
            return (JsonNode.Parse(line) as JsonObject) ?? ErrorNode("The window helper answered oddly.");
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            Settle(id, string.Empty);
            return ErrorNode("The window helper didn't answer.");
        }
        catch (OperationCanceledException)
        {
            Settle(id, string.Empty);
            throw;
        }
    }

    private void EnsureLocked()
    {
        if (_child is { HasExited: false })
            return;
        _child?.Dispose();
        var started = _start();
        _child = started;
        started.EnableRaisingEvents = true;
        started.Exited += (_, _) => OnExit(started);
        _reader = Task.Run(() => ReadLoopAsync(started));
    }

    private async Task ReadLoopAsync(Process child)
    {
        try
        {
            string? line;
            while ((line = await child.StandardOutput.ReadLineAsync()) != null)
            {
                int id;
                try
                {
                    var answer = JsonNode.Parse(line) as JsonObject;
                    id = answer?["id"]?.GetValue<int>() ?? -1;
                }
                catch
                {
                    continue;
                }
                if (id >= 0)
                    Settle(id, line);
            }
        }
        catch
        {
            // The process went away; OnExit settles the pending calls.
        }
    }

    private void OnExit(Process child)
    {
        List<int> ids;
        lock (_gate)
        {
            if (!ReferenceEquals(_child, child))
                return;
            _child = null;
            ids = new List<int>(_pending.Keys);
        }
        var answer = ErrorNode("The window helper stopped.").ToJsonString();
        foreach (var id in ids)
            Settle(id, answer);
    }

    private void Settle(int id, string line)
    {
        TaskCompletionSource<string>? waiting;
        lock (_gate)
        {
            if (!_pending.TryGetValue(id, out waiting))
                return;
            _pending.Remove(id);
        }
        if (string.IsNullOrEmpty(line))
            waiting.TrySetCanceled();
        else
            waiting.TrySetResult(line);
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        Process? child;
        lock (_gate)
        {
            child = _child;
            _child = null;
            foreach (var waiting in _pending.Values)
                waiting.TrySetCanceled();
            _pending.Clear();
        }
        try
        {
            if (child is { HasExited: false })
                child.Kill();
        }
        catch
        {
            // Already gone.
        }
        child?.Dispose();
    }

    internal static JsonObject ErrorNode(string error)
    {
        return new JsonObject { ["ok"] = false, ["error"] = error };
    }
}

/// <summary>
/// Keeps Dahlia's own windows out of what she sees and taps in another window. Her avatar,
/// chat and toasts stay on top of everything; where they overlapped the game she saw herself
/// instead of the game, and a tap there landed on her own window. For a tap or a swipe her
/// overlapping windows are hidden for that moment and shown again without taking the focus.
/// Windows that don't overlap the target are left alone, and guarded calls run one at a time,
/// so one call's restore never lands in the middle of another's tap.
/// A port of Electron's withDahliaOutOfTheWay. Electron also excluded its windows from screen
/// captures via content protection; Godot has no such API, so captures and peeks call through
/// (the screen capture path copies the whole screen and may include her windows).
/// </summary>
internal sealed class DahliaWindowGuard
{
    /// <summary>DWM applies a hidden window on its next frames.</summary>
    public static readonly TimeSpan Settle = TimeSpan.FromMilliseconds(80);

    private readonly DahliaWindowHelper _helper;
    private readonly Func<IEnumerable<Window>> _ownWindows;
    private readonly SemaphoreSlim _queue = new(1, 1);

    public DahliaWindowGuard(DahliaWindowHelper helper, Func<IEnumerable<Window>> ownWindows)
    {
        _helper = helper;
        _ownWindows = ownWindows;
    }

    public async Task<JsonObject> CallAsync(JsonObject request, CancellationToken cancellationToken = default)
    {
        var op = request["op"]?.GetValue<string>();
        if (op != "tap" && op != "swipe")
            return await _helper.CallAsync(request, cancellationToken);

        await _queue.WaitAsync(cancellationToken);
        try
        {
            var windows = await InTheWayAsync(request, cancellationToken);
            foreach (var window in windows)
            {
                if (GodotObject.IsInstanceValid(window) && window.Visible)
                    window.Hide();
            }
            try
            {
                await Task.Delay(Settle, cancellationToken);
                return await _helper.CallAsync(request, cancellationToken);
            }
            finally
            {
                foreach (var window in windows)
                {
                    if (GodotObject.IsInstanceValid(window) && !window.Visible)
                        window.Show();
                }
            }
        }
        finally
        {
            _queue.Release();
        }
    }

    private async Task<List<Window>> InTheWayAsync(JsonObject request, CancellationToken cancellationToken)
    {
        var hwnd = request["hwnd"]?.GetValue<long>() ?? 0;
        if (hwnd == 0)
            return new List<Window>();
        JsonObject frame;
        try
        {
            frame = await _helper.CallAsync(new JsonObject { ["op"] = "frame", ["hwnd"] = hwnd }, cancellationToken);
        }
        catch
        {
            return new List<Window>();
        }
        if (frame["ok"]?.GetValue<bool>() != true)
            return new List<Window>();
        var target = new Rect2I(
            frame["left"]?.GetValue<int>() ?? 0,
            frame["top"]?.GetValue<int>() ?? 0,
            frame["width"]?.GetValue<int>() ?? 0,
            frame["height"]?.GetValue<int>() ?? 0);

        var overlapping = new List<Window>();
        foreach (var window in _ownWindows())
        {
            if (!GodotObject.IsInstanceValid(window) || !window.Visible)
                continue;
            // Godot window geometry is in screen coordinates; the helper frame is in
            // physical pixels, so on a scaled display this overestimates slightly and
            // hides a window that merely sits close. Hiding too much is the safe side.
            var bounds = new Rect2I(window.Position, window.Size);
            if (bounds.Intersects(target))
                overlapping.Add(window);
        }
        return overlapping;
    }
}

/// <summary>
/// Answers "dahlia:window" calls: with the helper on Windows, with an explanation elsewhere.
/// </summary>
internal sealed class DahliaWindowService : IDisposable
{
    private readonly DahliaWindowHelper? _helper;
    private readonly DahliaWindowGuard? _guard;
    private readonly IDisposable _registration;
    private bool _disposed;

    private DahliaWindowService(DahliaWindowHelper? helper, DahliaWindowGuard? guard, IDisposable registration)
    {
        _helper = helper;
        _guard = guard;
        _registration = registration;
    }

    public static string ResolveHelperScript()
    {
        return ProjectSettings.GlobalizePath("res://resources/dahlia-window-helper.ps1");
    }

    public static DahliaWindowService Attach(IEventContext context, Func<IEnumerable<Window>> ownWindows, string? scriptPath = null)
    {
        if (!OperatingSystem.IsWindows())
        {
            return new DahliaWindowService(null, null, context.RegisterInvokeHandler(
                DahliaEvents.WindowCall,
                (DahliaHostCallRequest _, CancellationToken _) => Task.FromResult(
                    DahliaContracts.OkError("Dahlia plays games only in the Windows app."))));
        }

        var resolved = scriptPath ?? ResolveHelperScript();
        var helper = new DahliaWindowHelper(() => StartHelper(resolved));
        var guard = new DahliaWindowGuard(helper, ownWindows);
        DahliaWindowService? service = null;
        var registration = context.RegisterInvokeHandler(
            DahliaEvents.WindowCall,
            async (DahliaHostCallRequest payload, CancellationToken cancellationToken) =>
            {
                try
                {
                    var request = JsonNode.Parse(payload.Json) as JsonObject
                        ?? DahliaWindowHelper.ErrorNode("Unknown request.");
                    var answer = await guard.CallAsync(request, cancellationToken);
                    return DahliaContracts.Answer(answer);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception error)
                {
                    return DahliaContracts.OkError(error.Message);
                }
            });
        service = new DahliaWindowService(helper, guard, registration);
        return service;
    }

    internal DahliaWindowHelper Helper => _helper ?? throw new InvalidOperationException("The window helper runs only in the Windows app.");

    private static Process StartHelper(string script)
    {
        // Windows PowerShell 5.1 comes with every Windows; its .NET has the drawing
        // classes the helper uses.
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                ArgumentList = { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script },
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            },
        };
        if (!process.Start())
            throw new InvalidOperationException("The window helper couldn't start.");
        process.StandardInput.AutoFlush = true;
        process.ErrorDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data))
                GD.PushWarning($"Dahlia window helper: {args.Data.Trim()}");
        };
        process.BeginErrorReadLine();
        return process;
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _registration.Dispose();
        _helper?.Dispose();
    }
}
