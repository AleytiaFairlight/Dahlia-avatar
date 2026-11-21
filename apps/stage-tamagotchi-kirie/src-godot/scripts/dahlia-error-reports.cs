using System.Text.Json;
using Eventa;
using GdKirie.EventaAdapter;
using Godot;

/// <summary>
/// Dahlia host error reports: what the desktop app's windows can't report
/// themselves, for the error log on Dahlia's server
/// (stage-ui <c>libs/dahlia-error-reports.ts</c> sends them to
/// <c>POST /api/v1/dahlia/errors</c>): host-process exceptions and IPC /
/// Eventa failures. They wait in <c>user://dahlia-error-reports.jsonl</c>
/// until a window takes them through
/// <c>eventa:invoke:dahlia:error-reports:take</c> and sends them with the
/// Dahlia key, which only the windows have. Nothing goes to Sentry.
///
/// Port of Electron's <c>src/main/dahlia-error-reports.ts</c>
/// (<c>queueDahliaErrorReport</c>, the take channel, the uncaught-exception
/// hook). Not ported, as Godot has neither: Chromium's crash reporter and
/// native crash dumps, render/child process-gone hooks (no helper
/// processes), and the storage-guard / window-recovery findings (separate
/// parity areas).
/// Script errors and unhandled rejections inside the windows are reported
/// by the renderer's own reporter once it registers this take channel as a
/// source; that renderer wiring is still open.
/// </summary>
internal sealed class DahliaErrorReports : IDisposable
{
    public const string PendingFileName = "dahlia-error-reports.jsonl";

    /// <summary>The pending reports are dropped beyond this size; a window takes them every few minutes.</summary>
    private const long MaxPendingBytes = 512 * 1024;

    private readonly string _pendingPath;
    private readonly string _platform;
    private readonly string? _appVersion;
    private bool _disposed;

    public DahliaErrorReports(
        string pendingDirectory,
        string platform,
        string? appVersion = null)
    {
        _pendingPath = Path.Combine(pendingDirectory, PendingFileName);
        _platform = platform;
        _appVersion = string.IsNullOrWhiteSpace(appVersion) ? null : appVersion;

        // Observes without changing what an uncaught error does, mirroring
        // Electron's uncaughtExceptionMonitor (which still runs Electron's
        // own handling).
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
    }

    /// <summary>Registers the take channel a window uses to collect the pending reports.</summary>
    public IDisposable Attach(IEventContext context)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return context.RegisterInvokeHandler(
            AiriDesktopEvents.TakeDahliaErrorReports,
            (EmptyPayload _, CancellationToken _) => Task.FromResult(Take()));
    }

    /// <summary>Appends one report at once, so a report written while the process dies isn't lost.</summary>
    public void Queue(
        string kind,
        string message,
        string? stack = null,
        string source = "main",
        string? page = null,
        long? time = null)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return;
        }

        try
        {
            if (File.Exists(_pendingPath) && new FileInfo(_pendingPath).Length > MaxPendingBytes)
            {
                return;
            }

            var report = new DahliaErrorReportPayload(
                kind,
                message,
                stack,
                source,
                page,
                _platform,
                time ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            File.AppendAllText(
                _pendingPath,
                JsonSerializer.Serialize(report, AiriDesktopJsonContext.Default.DahliaErrorReportPayload)
                    + "\n");
        }
        catch
        {
            // Nowhere to report a failed report.
        }
    }

    /// <summary>Reads the pending reports and clears them, so the next take sees only new ones.</summary>
    public DahliaErrorReportsPayload Take()
    {
        List<DahliaErrorReportPayload> reports = [];
        try
        {
            if (File.Exists(_pendingPath))
            {
                foreach (var line in File.ReadAllLines(_pendingPath))
                {
                    if (string.IsNullOrWhiteSpace(line))
                    {
                        continue;
                    }

                    if (TryParseLine(line, out var report) && report is not null)
                    {
                        reports.Add(report);
                    }
                }

                File.WriteAllText(_pendingPath, string.Empty);
            }
        }
        catch (Exception error)
        {
            GD.PushWarning($"Could not read the pending Dahlia error reports: {error}");
        }

        return new DahliaErrorReportsPayload(_appVersion, reports);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        AppDomain.CurrentDomain.UnhandledException -= OnUnhandledException;
        TaskScheduler.UnobservedTaskException -= OnUnobservedTaskException;
    }

    /// <summary>Reads the app version from the Godot project settings, when configured.</summary>
    public static string? ReadAppVersion()
    {
        var version = ProjectSettings.GetSetting("application/config/version", string.Empty).AsString();
        return string.IsNullOrWhiteSpace(version) ? null : version;
    }

    /// <summary>The route of the window; a file page's path would also show where the app is installed.</summary>
    internal static string? RouteOf(string? url)
    {
        if (string.IsNullOrEmpty(url))
        {
            return null;
        }

        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed))
        {
            return null;
        }

        // Uri.Fragment keeps the leading '#', matching Electron's hash (e.g. "#/chat").
        var route = parsed.Fragment.Split('?')[0];
        if (!string.IsNullOrEmpty(route))
        {
            return route;
        }

        var page = Path.GetFileName(parsed.AbsolutePath.TrimEnd('/'));
        return string.IsNullOrEmpty(page) ? null : page;
    }

    internal static bool TryParseLine(string line, out DahliaErrorReportPayload? report)
    {
        report = null;
        try
        {
            report = JsonSerializer.Deserialize(line, AiriDesktopJsonContext.Default.DahliaErrorReportPayload);
            return report is not null && !string.IsNullOrWhiteSpace(report.Message);
        }
        catch
        {
            return false;
        }
    }

    private void OnUnhandledException(object? sender, UnhandledExceptionEventArgs args)
    {
        var (message, stack) = ErrorText(args.ExceptionObject);
        Queue("main-uncaught", message, stack);
    }

    private void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs args)
    {
        var (message, stack) = ErrorText(args.Exception);
        Queue("main-unhandledrejection", message, stack);
    }

    private static (string Message, string? Stack) ErrorText(object? error)
    {
        if (error is Exception exception)
        {
            return ($"{exception.GetType().Name}: {exception.Message}", exception.StackTrace);
        }

        return (error?.ToString() ?? "unknown", null);
    }
}
