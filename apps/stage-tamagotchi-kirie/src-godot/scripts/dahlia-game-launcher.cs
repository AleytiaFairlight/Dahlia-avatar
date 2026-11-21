using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text.Json.Nodes;
using Eventa;
using Microsoft.Win32;

/// <summary>
/// Finds games installed on this PC and starts them, for Dahlia, on the
/// "dahlia:game-launcher" channel. She looks where games are: Start menu and desktop
/// shortcuts, the installed-programs list in the registry, Program Files, the Steam and
/// Epic libraries and game folders on every drive. Only names are read; starting a game
/// is the ask-first part (the tool isn't read-only). A port of Electron's
/// src/main/dahlia-game-launcher.ts (ranking, budgets and launch rules kept).
/// </summary>
internal sealed class DahliaGameLauncherService : IDisposable
{
    public sealed record GameCandidate(string Path, string? Target, string Source, int Score);

    public static readonly HashSet<string> Launchable = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".lnk", ".url", ".appref-ms",
    };

    /// <summary>Programs next to a game that aren't the game.</summary>
    public const string NotTheGamePattern = @"unins|setup|install|update|patch|crash|report|helper|redist|vc_?redist|dxsetup|prereq|cef|webview|elevat|service|bugtrace|anticheat|easyanticheat|battleye";

    /// <summary>Folders never worth walking into.</summary>
    public static readonly HashSet<string> SkipFolders = new(StringComparer.OrdinalIgnoreCase)
    {
        "windows", "$recycle.bin", "system volume information", "node_modules", ".git",
        "windowsapps", "microsoft", "common files", "windows defender", "windowspowershell", "temp", "cache", "logs",
    };

    public const int MaxFolders = 25_000;
    public const int SearchMs = 25_000;
    public const int MaxResults = 10;

    private readonly IDisposable _registration;
    private bool _disposed;

    public DahliaGameLauncherService(IDisposable registration)
    {
        _registration = registration;
    }

    /// <summary>Lower-case letters and digits only: "Dark War: Survival" -> "darkwarsurvival".</summary>
    public static string Compact(string text)
    {
        return string.Concat(text.ToLowerInvariant().Where(c => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')));
    }

    /// <summary>
    /// Whether a file or folder name is the game's: every word of the name is in it
    /// ("Dark War Survival.lnk", "DarkWarSurvival"), or it is the start of the name
    /// ("DarkWar" for "Dark War: Survival").
    /// </summary>
    public static bool NameMatches(string candidate, string name)
    {
        var c = Compact(Path.GetFileNameWithoutExtension(candidate) is { Length: > 0 } stem ? stem : candidate);
        // Words split on anything that isn't a letter or digit, like Electron's /[^a-z0-9]+/.
        var words = System.Text.RegularExpressions.Regex.Split(name.ToLowerInvariant(), "[^a-z0-9]+").Where(w => w.Length >= 2).ToArray();
        if (c.Length == 0 || words.Length == 0)
            return false;
        if (words.All(word => c.Contains(word, StringComparison.Ordinal)))
            return true;
        return c.Length >= 5 && Compact(name).StartsWith(c, StringComparison.Ordinal);
    }

    public static DahliaGameLauncherService Attach(IEventContext context)
    {
        if (!OperatingSystem.IsWindows())
        {
            return new DahliaGameLauncherService(context.RegisterInvokeHandler(
                DahliaEvents.GameLauncherCall,
                (DahliaHostCallRequest _, CancellationToken _) => Task.FromResult(
                    DahliaContracts.OkError("Finding and starting games works only in the Windows app."))));
        }

        DahliaGameLauncherService? service = null;
        var registration = context.RegisterInvokeHandler(
            DahliaEvents.GameLauncherCall,
            async (DahliaHostCallRequest payload, CancellationToken cancellationToken) =>
            {
                try
                {
                    var request = JsonNode.Parse(payload.Json) as JsonObject
                        ?? DahliaWindowHelper.ErrorNode("Unknown request.");
                    return DahliaContracts.Answer(await service!.AnswerAsync(request));
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception error)
                {
                    return DahliaContracts.OkError(error.Message.Length > 0 ? error.Message : "That failed.");
                }
            });
        service = new DahliaGameLauncherService(registration);
        return service;
    }

    internal Task<JsonObject> AnswerAsync(JsonObject request)
    {
        // The handler is only registered on Windows; this keeps the platform analyzer
        // (and any future caller) on the Windows-only search path below.
        if (!OperatingSystem.IsWindows())
            return Task.FromResult(DahliaWindowHelper.ErrorNode("Finding and starting games works only in the Windows app."));
        var op = request["op"]?.GetValue<string>();
        switch (op)
        {
            case "find":
            {
                var name = DahliaContracts.GetString(request, "name").Trim();
                if (name.Length == 0)
                    return Task.FromResult(DahliaWindowHelper.ErrorNode("Give the game's name."));
                var folder = DahliaContracts.GetString(request, "folder").Trim();
                string? root = folder.Length > 0 ? folder : null;
                if (root is not null && !Directory.Exists(root))
                    return Task.FromResult(DahliaWindowHelper.ErrorNode($"{root} isn't a folder."));
                var candidates = FindGame(name, root);
                var array = new JsonArray();
                foreach (var candidate in candidates)
                {
                    var node = new JsonObject { ["path"] = candidate.Path, ["source"] = candidate.Source, ["score"] = candidate.Score };
                    if (candidate.Target is not null)
                        node["target"] = candidate.Target;
                    array.Add(node);
                }
                return Task.FromResult(new JsonObject { ["ok"] = true, ["candidates"] = array });
            }
            case "launch":
                return Task.FromResult(LaunchGame(DahliaContracts.GetString(request, "path")));
            default:
                return Task.FromResult(DahliaWindowHelper.ErrorNode("Unknown request."));
        }
    }

    [SupportedOSPlatform("windows")]
    internal static List<GameCandidate> FindGame(string name, string? folder)
    {
        var budget = new SearchBudget { Folders = MaxFolders, Until = DateTime.UtcNow.AddMilliseconds(SearchMs) };
        var found = new List<GameCandidate>();
        var env = System.Environment.GetEnvironmentVariables();
        string? Env(string key) => env[key] as string;

        // Shortcuts: what the user clicks, with the right folder and arguments.
        var shortcutFolders = new[]
        {
            Join(Env("ProgramData"), "Microsoft", "Windows", "Start Menu", "Programs"),
            Join(Env("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs"),
            Join(Env("USERPROFILE"), "Desktop"),
            Join(Env("USERPROFILE"), "OneDrive", "Desktop"),
            Join(Env("PUBLIC"), "Desktop"),
        }.Where(dir => dir is not null).Select(dir => dir!);
        var shortcutTargets = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var dir in shortcutFolders)
            WalkShortcuts(dir, 0, name, found, shortcutTargets, budget);

        // The installed-programs list: its icon is often the game's program, its folder holds it.
        foreach (var program in InstalledPrograms())
        {
            if (budget.Exceeded)
                break;
            if (!NameMatches(program.Name, name))
                continue;
            var icon = System.Text.RegularExpressions.Regex.Replace(program.Icon ?? string.Empty, "^\"|\"?,-?\\d+\"?$", string.Empty);
            if (icon.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && !IsNotTheGame(Path.GetFileName(icon)) && File.Exists(icon))
                found.Add(new GameCandidate(icon, null, "installed", 9));
            if (program.Folder is not null && Directory.Exists(program.Folder))
            {
                foreach (var game in GameProgramsIn(program.Folder, name, 7, budget))
                    found.Add(game with { Source = "installed" });
            }
        }

        // Folders named like the game, where games are installed.
        var roots = new List<(string Dir, int Depth)>();
        if (folder is not null)
            roots.Add((folder, 6));
        foreach (var dir in new[] { Env("ProgramFiles"), Env("ProgramFiles(x86)"), Env("LOCALAPPDATA"), Join(Env("LOCALAPPDATA"), "Programs"), Env("APPDATA") })
        {
            if (dir is not null)
                roots.Add((dir, 2));
        }
        foreach (var drive in Drives())
        {
            roots.Add((drive, 2));
            foreach (var library in new[] { @"SteamLibrary\steamapps\common", @"Program Files (x86)\Steam\steamapps\common", @"Program Files\Epic Games", "Games", "XboxGames" })
                roots.Add((Path.Combine(drive, library), 1));
        }
        foreach (var (dir, depth) in roots)
        {
            if (budget.Exceeded)
                break;
            if (Directory.Exists(dir))
                WalkFolders(dir, 0, depth, name, folder is not null, found, budget);
        }

        // One entry per program: a shortcut and its target are the same game.
        var best = new Dictionary<string, GameCandidate>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in found)
        {
            var key = (candidate.Target ?? candidate.Path).ToLowerInvariant();
            if (!best.TryGetValue(key, out var known) || candidate.Score > known.Score)
                best[key] = candidate;
        }
        return best.Values.OrderByDescending(c => c.Score).Take(MaxResults).ToList();
    }

    private sealed class SearchBudget
    {
        public int Folders;
        public DateTime Until;
        public bool Exceeded => Folders <= 0 || DateTime.UtcNow > Until;
    }

    private sealed record InstalledProgram(string Name, string? Folder, string? Icon);

    private static bool IsNotTheGame(string fileName)
    {
        return System.Text.RegularExpressions.Regex.IsMatch(fileName, NotTheGamePattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    private static void WalkShortcuts(string dir, int level, string name, List<GameCandidate> found, Dictionary<string, string?> targets, SearchBudget budget)
    {
        if (level > 3 || budget.Exceeded)
            return;
        string[] entries;
        try
        {
            entries = Directory.GetFileSystemEntries(dir);
        }
        catch
        {
            return;
        }
        foreach (var entry in entries)
        {
            if (budget.Exceeded)
                return;
            if (Directory.Exists(entry))
            {
                budget.Folders--;
                WalkShortcuts(entry, level + 1, name, found, targets, budget);
                continue;
            }
            var ext = Path.GetExtension(entry).ToLowerInvariant();
            if (!Launchable.Contains(ext) || ext == ".exe" || !NameMatches(Path.GetFileName(entry), name) || IsNotTheGame(Path.GetFileName(entry)))
                continue;
            string? target = null;
            if (ext == ".lnk")
            {
                if (!targets.TryGetValue(entry, out target))
                    targets[entry] = target = ShortcutTarget(entry);
                if (target is not null && (!target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || IsNotTheGame(Path.GetFileName(target))))
                    continue;
            }
            found.Add(new GameCandidate(entry, target, "shortcut", 10));
        }
    }

    private static List<GameCandidate> GameProgramsIn(string folder, string name, int @base, SearchBudget budget)
    {
        var result = new List<GameCandidate>();
        foreach (var (file, depth) in ProgramsIn(folder, 3, budget))
        {
            result.Add(new GameCandidate(
                file, null, "folder",
                @base + (NameMatches(Path.GetFileName(file), name) ? 3 : 0) + (Path.GetFileName(file).Contains("launcher", StringComparison.OrdinalIgnoreCase) ? 1 : 0) - depth));
        }
        return result;
    }

    private static List<(string File, int Depth)> ProgramsIn(string folder, int depth, SearchBudget budget)
    {
        var found = new List<(string, int)>();
        Walk(folder, 0);
        return found;

        void Walk(string dir, int level)
        {
            if (level > depth || budget.Exceeded)
                return;
            budget.Folders--;
            string[] entries;
            try
            {
                entries = Directory.GetFileSystemEntries(dir);
            }
            catch
            {
                return;
            }
            var subdirs = new List<string>();
            foreach (var entry in entries)
            {
                if (Directory.Exists(entry))
                    subdirs.Add(entry);
                else if (entry.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && !IsNotTheGame(Path.GetFileName(entry)))
                    found.Add((entry, level));
            }
            foreach (var subdir in subdirs)
            {
                if (!SkipFolders.Contains(Path.GetFileName(subdir)))
                    Walk(subdir, level + 1);
            }
        }
    }

    private static void WalkFolders(string dir, int level, int depth, string name, bool directExes, List<GameCandidate> found, SearchBudget budget)
    {
        if (level > depth || budget.Exceeded)
            return;
        budget.Folders--;
        string[] entries;
        try
        {
            entries = Directory.GetFileSystemEntries(dir);
        }
        catch
        {
            return;
        }
        foreach (var entry in entries)
        {
            if (budget.Exceeded)
                return;
            if (Directory.Exists(entry) && !SkipFolders.Contains(Path.GetFileName(entry).ToLowerInvariant()))
            {
                if (NameMatches(Path.GetFileName(entry), name))
                {
                    foreach (var game in GameProgramsIn(entry, name, 5, budget))
                        found.Add(game);
                }
                else
                {
                    WalkFolders(entry, level + 1, depth, name, directExes, found, budget);
                }
            }
            else if (directExes && entry.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && NameMatches(Path.GetFileName(entry), name) && !IsNotTheGame(Path.GetFileName(entry)))
            {
                found.Add(new GameCandidate(entry, null, "folder", 6));
            }
        }
    }

    [SupportedOSPlatform("windows")]
    private static List<InstalledProgram> InstalledPrograms()
    {
        var programs = new List<InstalledProgram>();
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            foreach (var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
            {
                try
                {
                    using var root = RegistryKey.OpenBaseKey(hive, view);
                    using var uninstall = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall");
                    if (uninstall is null)
                        continue;
                    foreach (var sub in uninstall.GetSubKeyNames())
                    {
                        try
                        {
                            using var key = uninstall.OpenSubKey(sub);
                            var display = key?.GetValue("DisplayName") as string;
                            if (string.IsNullOrWhiteSpace(display))
                                continue;
                            programs.Add(new InstalledProgram(
                                display,
                                key?.GetValue("InstallLocation") as string,
                                key?.GetValue("DisplayIcon") as string));
                        }
                        catch
                        {
                            // One broken entry doesn't stop the list.
                        }
                    }
                }
                catch
                {
                    // A missing hive doesn't stop the list.
                }
            }
        }
        return programs;
    }

    private static IEnumerable<string> Drives()
    {
        foreach (var drive in DriveInfo.GetDrives())
        {
            string root;
            try
            {
                root = drive.RootDirectory.FullName;
                if (!drive.IsReady)
                    continue;
            }
            catch
            {
                continue;
            }
            yield return root;
        }
    }

    private static string? Join(params string?[] parts)
    {
        var present = parts.Where(part => !string.IsNullOrEmpty(part)).Select(part => part!).ToArray();
        if (present.Length == 0)
            return null;
        try
        {
            return Path.Combine(present);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>The program a .lnk starts, or null. Read through PowerShell's WScript.Shell, cached per find.</summary>
    private static string? ShortcutTarget(string file)
    {
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    ArgumentList = { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", $"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{file.Replace("'", "''")}');$s.TargetPath" },
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                },
            };
            if (!process.Start())
                return null;
            var target = process.StandardOutput.ReadToEnd().Trim();
            process.WaitForExit(10_000);
            return target.Length > 0 ? target : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Starts a program or shortcut, from its own folder, apart from this app.</summary>
    public static JsonObject LaunchGame(string file)
    {
        var target = file.Trim().Trim('"');
        var ext = Path.GetExtension(target).ToLowerInvariant();
        if (!Path.IsPathFullyQualified(target) || !Launchable.Contains(ext))
            return DahliaWindowHelper.ErrorNode("Give the full path of a program (.exe) or a shortcut (.lnk, .url).");
        if (!File.Exists(target) && !Directory.Exists(target))
            return DahliaWindowHelper.ErrorNode($"{target} doesn't exist.");

        if (ext != ".exe")
        {
            try
            {
                Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
                return new JsonObject { ["ok"] = true };
            }
            catch (Exception error)
            {
                return DahliaWindowHelper.ErrorNode(error.Message);
            }
        }
        try
        {
            using var child = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = target,
                    WorkingDirectory = Path.GetDirectoryName(target) ?? string.Empty,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                },
            };
            if (!child.Start())
                return DahliaWindowHelper.ErrorNode("It didn't start.");
            child.Dispose();
            return new JsonObject { ["ok"] = true };
        }
        catch (Exception error)
        {
            return DahliaWindowHelper.ErrorNode($"It didn't start: {error.Message}");
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _registration.Dispose();
    }
}
