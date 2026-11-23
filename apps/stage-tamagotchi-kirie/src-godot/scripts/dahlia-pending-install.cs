using System.IO;
using System.Text.Json;

/// <summary>Dahlia: what the host should do with a pending-install marker at startup.</summary>
internal enum PendingInstallAction
{
    /// <summary>No marker (or nothing is known): boot normally.</summary>
    None,
    /// <summary>A stale or already-installed marker: delete it and its staged files, then boot.</summary>
    Cleanup,
    /// <summary>A staged release newer than the running host: install it and quit.</summary>
    InstallAndQuit,
}

/// <summary>
/// Dahlia: the pending-install marker (written by the updater on quit, read on the next start)
/// plus the policy for it. Everything here takes explicit paths and strings so the harness can
/// cover it without the engine; only the C# standard library is used.
/// </summary>
internal static class DahliaPendingInstallIO
{
    public const string MarkerFileName = "pending-install.json";

    /// <summary>The updates staging folder name under the user-data directory.</summary>
    public const string StagingDirectoryName = "updates";

    /// <summary>
    /// What to do with a marker: nothing without one, clean up what is stale or already
    /// installed (including an unreadable marker version), and install a staged release that is
    /// newer than the running host — or clean up when its installer file is gone.
    /// </summary>
    public static PendingInstallAction Decide(string? markerVersion, string? currentVersion, bool setupPresent)
    {
        if (string.IsNullOrEmpty(markerVersion))
        {
            return PendingInstallAction.None;
        }

        if (!DahliaAppVersion.TryParse(markerVersion, out _, out _, out _, out _))
        {
            return PendingInstallAction.Cleanup;
        }

        if (string.IsNullOrEmpty(currentVersion)
            || !DahliaAppVersion.TryParse(currentVersion, out _, out _, out _, out _))
        {
            return PendingInstallAction.None;
        }

        if (!DahliaAppVersion.IsUpdateAvailable(markerVersion, currentVersion))
        {
            return PendingInstallAction.Cleanup;
        }

        return setupPresent ? PendingInstallAction.InstallAndQuit : PendingInstallAction.Cleanup;
    }

    /// <summary>The staged installer, if the manifest lists one; null when the release has none.</summary>
    public static string? PickSetupInstaller(IEnumerable<string> fileNames)
    {
        foreach (var name in fileNames)
        {
            if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                return name;
            }
        }

        return null;
    }

    /// <summary>Reads the marker, or null when there is none. An unreadable marker is removed.</summary>
    public static DahliaPendingInstall? Read(string stagingDirectory)
    {
        var path = Path.Combine(stagingDirectory, MarkerFileName);
        string text;
        try
        {
            text = File.ReadAllText(path);
        }
        catch
        {
            return null;
        }

        try
        {
            var marker = JsonSerializer.Deserialize<DahliaPendingInstall>(text);
            if (string.IsNullOrEmpty(marker?.Version) || marker?.Files is null)
            {
                TryDelete(path);
                return null;
            }

            return marker;
        }
        catch
        {
            TryDelete(path);
            return null;
        }
    }

    public static void Write(string stagingDirectory, DahliaPendingInstall marker)
    {
        Directory.CreateDirectory(stagingDirectory);
        File.WriteAllText(
            Path.Combine(stagingDirectory, MarkerFileName),
            JsonSerializer.Serialize(marker));
    }

    /// <summary>Removes the marker and every staged file it names. Never throws.</summary>
    public static void Cleanup(string stagingDirectory, DahliaPendingInstall marker)
    {
        foreach (var name in marker.Files)
        {
            try
            {
                var path = Path.Combine(stagingDirectory, name);
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch
            {
                // Locked or gone already: tried again on a later start.
            }
        }

        TryDelete(Path.Combine(stagingDirectory, MarkerFileName));
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // Locked or gone already: tried again on a later start.
        }
    }
}
