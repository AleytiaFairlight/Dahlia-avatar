using Godot;

/// <summary>
/// Dahlia's host log: a timestamped file next to Godot's own log, so a startup
/// crash still leaves a trace of how far the host got.
///
/// Location: <c>user://logs/dahlia-host.log</c> — on Windows,
/// <c>%APPDATA%\Godot\app_userdata\Dahlia\logs\dahlia-host.log</c>, next to
/// Godot's <c>godot.log</c>. Every line goes to the file and to
/// <see cref="GD.Print"/>, so the console wrapper shows it too when present.
///
/// Godot APIs segfault outside the engine, so the engine-dependent parts
/// (log directory, printing, version banner) run only in <see cref="Init"/>.
/// Tests use <see cref="InitForTests"/>, which touches plain .NET only.
/// </summary>
internal static class DahliaLog
{
    /// <summary>One log file per size cap; the previous file keeps a <c>.1</c> suffix.</summary>
    private const long MaxBytes = 2L * 1024 * 1024;

    private static readonly Lock s_lock = new();
    private static Action<string>? s_print;
    private static string? s_path;
    private static bool s_ready;

    public static string Path
    {
        get
        {
            lock (s_lock)
            {
                return s_path ?? "<uninitialized>";
            }
        }
    }

    /// <summary>
    /// Opens the log and writes the startup banner. Call first in
    /// <c>Main._Ready</c>, before anything that can fail. Never throws.
    /// </summary>
    public static void Init()
    {
        InitCore(logDirectoryOverride: null, printOverride: null);

        var version = Engine.GetVersionInfo();
        Write($"Dahlia host starting (app {DahliaErrorReports.ReadAppVersion()}, " +
            $"Godot {version["string"]}, {System.Runtime.InteropServices.RuntimeInformation.OSDescription}, " +
            $"{System.Runtime.InteropServices.RuntimeInformation.OSArchitecture})");
        Write($"Command line: {string.Join(" ", OS.GetCmdlineArgs())}");
    }

    /// <summary>
    /// Test seam: same file logging without touching the engine. Never throws.
    /// </summary>
    internal static void InitForTests(string logDirectory, Action<string> print)
    {
        InitCore(logDirectory, print);
        Write("Dahlia host starting (test)");
    }

    private static void InitCore(string? logDirectoryOverride, Action<string>? printOverride)
    {
        string directory;
        if (logDirectoryOverride is not null)
        {
            directory = logDirectoryOverride;
        }
        else
        {
            try
            {
                directory = ProjectSettings.GlobalizePath("user://logs");
            }
            catch (Exception error)
            {
                GD.PushError($"Dahlia: cannot open the host log: {error.Message}");
                return;
            }
        }

        try
        {
            Directory.CreateDirectory(directory);
            var path = System.IO.Path.Combine(directory, "dahlia-host.log");
            Rotate(path);
            lock (s_lock)
            {
                s_print = printOverride;
                s_path = path;
                s_ready = true;
            }
        }
        catch (Exception error)
        {
            GD.PushError($"Dahlia: cannot open the host log: {error.Message}");
            return;
        }

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            var error = args.ExceptionObject as Exception;
            Write(error is null ? "Unhandled exception (no details)." : $"UNHANDLED: {error}");
            Write($"Runtime terminating: {args.IsTerminating}");
        };
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            Write($"UNOBSERVED TASK: {args.Exception}");
            args.SetObserved();
        };
    }

    /// <summary>A milestone line. Never throws; falls back to <see cref="GD.Print"/>.</summary>
    public static void Write(string message)
    {
        var line = $"[{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}Z] {message}";
        Print(line);
        lock (s_lock)
        {
            if (!s_ready || s_path is null)
                return;
            try
            {
                File.AppendAllText(s_path, line + "\n");
            }
            catch (Exception)
            {
                // The log must never break the host.
            }
        }
    }

    private static void Print(string line)
    {
        Action<string>? print;
        lock (s_lock)
        {
            print = s_print;
        }

        if (print is not null)
        {
            print(line);
            return;
        }

        GD.Print(line);
    }

    private static void Rotate(string path)
    {
        try
        {
            if (File.Exists(path) && new FileInfo(path).Length > MaxBytes)
            {
                var backup = path + ".1";
                if (File.Exists(backup))
                    File.Delete(backup);
                File.Move(path, backup);
            }
        }
        catch (Exception)
        {
            // Start fresh on rotation trouble.
        }
    }
}
