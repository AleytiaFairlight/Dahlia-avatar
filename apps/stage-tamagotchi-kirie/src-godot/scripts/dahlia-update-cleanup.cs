using System.Text.RegularExpressions;

/// <summary>
/// Dahlia: removes old Kirie release files from the Downloads folder when the host starts.
/// Mirrors apps/stage-tamagotchi/src/main/dahlia-update-cleanup.ts, which dahlia-auto-update.ts
/// runs on the desktop host.
/// Kirie release files are Dahlia-Kirie-&lt;version&gt;-windows-x64.zip downloads (with a browser's
/// " (1)" copies); only versions older than the running host go. Everything else stays.
/// </summary>
internal static partial class DahliaUpdateCleanup
{
    /// <summary>
    /// The download folder, the running version, and file access come from the caller so the
    /// matching stays testable without the engine.
    /// </summary>
    public static async Task<IReadOnlyList<string>> CleanOldKirieDownloadsAsync(
        string folder,
        string runningVersion,
        Func<string, string[]>? list = null,
        Func<string, Task>? remove = null)
    {
        string[] names;
        try
        {
            names = list is not null ? list(folder) : DefaultList(folder);
        }
        catch
        {
            return [];
        }

        Func<string, Task> removeFile = remove ?? new Func<string, Task>(DefaultRemove);
        var removed = new List<string>();
        foreach (var name in OldReleaseFiles(names, runningVersion))
        {
            try
            {
                await removeFile(Path.Combine(folder, name));
                removed.Add(name);
            }
            catch
            {
                // Open in another program, or gone already: it is tried again at the next start.
            }
        }

        return removed;
    }

    /// <summary>The version in the name of a Kirie release file; null for any other file.</summary>
    public static string? ReleaseFileVersion(string name)
    {
        var version = ReleaseFilePattern().Match(name).Groups[1].Value;
        if (string.IsNullOrEmpty(version))
        {
            return null;
        }

        return DahliaAppVersion.TryParse(version, out _, out _, out _, out _) ? version : null;
    }

    /// <summary>The release files in a folder that are older than the version that runs.</summary>
    public static IReadOnlyList<string> OldReleaseFiles(IEnumerable<string> names, string runningVersion)
    {
        if (!DahliaAppVersion.TryParse(runningVersion, out _, out _, out _, out _))
        {
            return [];
        }

        return names
            .Where(name =>
                ReleaseFileVersion(name) is string version
                && DahliaAppVersion.Compare(version, runningVersion) < 0)
            .ToList();
    }

    private static string[] DefaultList(string folder)
    {
        return Directory.GetFiles(folder).Select(Path.GetFileName).OfType<string>().ToArray();
    }

    private static Task DefaultRemove(string path)
    {
        // Not recursive: a folder that happens to have such a name stays.
        File.Delete(path);
        return Task.CompletedTask;
    }

    [GeneratedRegex(
        @"^Dahlia-Kirie-(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)-windows-x64(?: \(\d+\))?\.zip$",
        RegexOptions.IgnoreCase)]
    private static partial Regex ReleaseFilePattern();
}
