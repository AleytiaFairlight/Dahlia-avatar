using System.Text.Json;

/// <summary>
/// Dahlia: a release on Dahlia's server, in the shape of GitHub's releases API. Mirrors
/// apps/stage-tamagotchi/src/main/dahlia-release-server.ts; the desktop host reads the same
/// servers through branding edits in auto-updater.ts.
/// </summary>
internal sealed record DahliaServerAsset(string? Name, string? BrowserDownloadUrl);

/// <summary>Dahlia: one release entry from Dahlia's server or GitHub's releases API.</summary>
internal sealed record DahliaServerRelease(
    string? TagName,
    bool Draft,
    bool Prerelease,
    IReadOnlyList<DahliaServerAsset> Assets);

/// <summary>
/// Dahlia: the update feed for a release. Dahlia's server keeps a copy of the newest release's
/// files and sends it faster than GitHub; the updater asks the server first and GitHub when the
/// server doesn't answer. The Kirie manifest in each release is kirie-latest-x64.json (see
/// docs/packaging-updates.md); the desktop host instead reads latest-x64.yml.
/// </summary>
internal static class DahliaUpdateFeed
{
    /// <summary>The release list on Dahlia's server, in the shape of GitHub's.</summary>
    public const string ServerReleasesUrl = "https://dahlia.aleytia.moe/api/v1/dahlia/releases";

    public const string GitHubReleasesApiUrl =
        "https://api.github.com/repos/AleytiaFairlight/Dahlia-avatar/releases";

    public const string GitHubReleaseDownloadBaseUrl =
        "https://github.com/AleytiaFairlight/Dahlia-avatar/releases/download";

    /// <summary>The Kirie update manifest carried by every release.</summary>
    public const string KirieUpdateFile = "kirie-latest-x64.json";

    /// <summary>
    /// Reads release entries from a releases payload. Anything that is not a JSON array reads as
    /// no releases, so a stray error page never becomes a release.
    /// </summary>
    public static IReadOnlyList<DahliaServerRelease> ParseReleases(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var releases = new List<DahliaServerRelease>();
        foreach (var entry in payload.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var assets = new List<DahliaServerAsset>();
            if (entry.TryGetProperty("assets", out var assetsElement)
                && assetsElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var asset in assetsElement.EnumerateArray())
                {
                    if (asset.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    assets.Add(new DahliaServerAsset(
                        GetString(asset, "name"),
                        GetString(asset, "browser_download_url")));
                }
            }

            releases.Add(new DahliaServerRelease(
                GetString(entry, "tag_name"),
                GetBool(entry, "draft"),
                GetBool(entry, "prerelease"),
                assets));
        }

        return releases;
    }

    /// <summary>
    /// The newest finished release: drafts never ship, and Dahlia's line is beta, so prereleases
    /// count. Returns the full tag (with its leading v).
    /// </summary>
    public static string? SelectNewestTag(IEnumerable<DahliaServerRelease> releases)
    {
        return DahliaAppVersion.TryPickNewestTag(
            releases
                .Where(release => !release.Draft && release.TagName is not null)
                .Select(release => release.TagName!));
    }

    /// <summary>
    /// The update feed for a release: the server folder that holds its update file (such as
    /// kirie-latest-x64.json) when the server has a copy of the release, or the fallback (the
    /// release on GitHub). A server asset that points anywhere but the server falls back, so a
    /// tampered list cannot send the updater elsewhere.
    /// </summary>
    public static string FeedUrlForRelease(
        IReadOnlyList<DahliaServerRelease> releases,
        string tag,
        string updateFile,
        string fallback)
    {
        var server = new Uri(ServerReleasesUrl);
        var asset = releases
            .Where(release => string.Equals(release.TagName, tag, StringComparison.Ordinal))
            .SelectMany(release => release.Assets)
            .FirstOrDefault(asset => string.Equals(asset.Name, updateFile, StringComparison.Ordinal))
            ?.BrowserDownloadUrl;
        if (asset is null)
        {
            return fallback;
        }

        // A root-relative copy resolves against the server, exactly like new URL(asset, server).
        if (!Uri.TryCreate(server, asset, out var url))
        {
            return fallback;
        }

        if (!url.IsAbsoluteUri
            || !string.Equals(url.Scheme, server.Scheme, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(url.Host, server.Host, StringComparison.OrdinalIgnoreCase)
            || url.Port != server.Port)
        {
            return fallback;
        }

        var absolute = url.AbsoluteUri;
        return absolute[..absolute.LastIndexOf('/')];
    }

    private static string? GetString(JsonElement entry, string name)
    {
        if (entry.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String)
        {
            return value.GetString();
        }

        return null;
    }

    private static bool GetBool(JsonElement entry, string name)
    {
        if (entry.TryGetProperty(name, out var value)
            && (value.ValueKind == JsonValueKind.True || value.ValueKind == JsonValueKind.False))
        {
            return value.GetBoolean();
        }

        return false;
    }
}
