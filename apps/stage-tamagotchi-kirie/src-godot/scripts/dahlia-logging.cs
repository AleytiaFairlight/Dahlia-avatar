using Godot;

/// <summary>
/// Dahlia's host log: a timestamped file the user can actually find, so a
/// startup crash still leaves a trace of how far the host got.
///
/// Location: <c>logs\dahlia-host.log</c> next to the host executable (the
/// unzipped Kirie folder), falling back to <c>user://logs</c> when the
/// executable folder is not writable (for example a protected install
/// location) or in debug/editor runs. Every line goes to the file and to
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

        Write($"Host log: {Path}");
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
            directory = ResolveLogDirectory();
            if (directory is null)
            {
                GD.PushError("Dahlia: cannot open the host log: no writable log folder.");
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

    /// <summary>
    /// Prefers <c>logs</c> next to the host executable (the unzipped Kirie
    /// folder, where the user can find it); falls back to <c>user://logs</c>
    /// when that folder is missing or read-only. Debug/editor runs always use
    /// <c>user://logs</c> so development never litters the editor install.
    /// Returns null when nothing is writable. Never throws.
    /// </summary>
    private static string? ResolveLogDirectory()
    {
        if (!OS.IsDebugBuild())
        {
            try
            {
                var exeDirectory = System.IO.Path.GetDirectoryName(OS.GetExecutablePath());
                if (!string.IsNullOrEmpty(exeDirectory))
                {
                    var local = System.IO.Path.Combine(exeDirectory, "logs");
                    Directory.CreateDirectory(local);
                    var probe = System.IO.Path.Combine(local, ".write-test");
                    File.WriteAllText(probe, "w");
                    File.Delete(probe);
                    return local;
                }
            }
            catch (Exception)
            {
                // Fall through to user://logs.
            }
        }

        try
        {
            return ProjectSettings.GlobalizePath("user://logs");
        }
        catch (Exception)
        {
            return null;
        }
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
