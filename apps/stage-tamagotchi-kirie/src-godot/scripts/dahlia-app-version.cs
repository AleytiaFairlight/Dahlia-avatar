using System.Text.RegularExpressions;

/// <summary>
/// Dahlia: the app release version (see scripts/avatar_app_version.py: major.minor.patch-beta.N).
/// The desktop host orders versions the way dahlia-update-cleanup.ts does through the semver
/// package: every numeric part compares as a number, not as text, so beta.5.9 is older than
/// beta.5.27. System.Version cannot hold the beta lane, so this parses the Dahlia shape itself.
/// </summary>
internal static partial class DahliaAppVersion
{
    public static bool TryParse(
        string? version,
        out int major,
        out int minor,
        out int patch,
        out string[] prerelease)
    {
        major = 0;
        minor = 0;
        patch = 0;
        prerelease = [];
        if (version is null)
        {
            return false;
        }

        var match = VersionPattern().Match(version);
        if (!match.Success)
        {
            return false;
        }

        major = int.Parse(match.Groups[1].Value);
        minor = int.Parse(match.Groups[2].Value);
        patch = int.Parse(match.Groups[3].Value);
        prerelease = match.Groups[4].Success
            ? match.Groups[4].Value.Split('.', StringSplitOptions.RemoveEmptyEntries)
            : [];
        return true;
    }

    /// <summary>
    /// Orders two Dahlia versions like semver: a version without a prerelease lane is newer than
    /// the same version with one, numeric prerelease parts compare as numbers, and a numeric part
    /// is older than an alphanumeric one.
    /// </summary>
    public static int Compare(string left, string right)
    {
        var leftOk = TryParse(left, out var leftMajor, out var leftMinor, out var leftPatch, out var leftLane);
        var rightOk = TryParse(right, out var rightMajor, out var rightMinor, out var rightPatch, out var rightLane);
        if (!leftOk || !rightOk)
        {
            return string.Compare(left, right, StringComparison.Ordinal);
        }

        var order = leftMajor.CompareTo(rightMajor);
        if (order != 0)
        {
            return order;
        }

        order = leftMinor.CompareTo(rightMinor);
        if (order != 0)
        {
            return order;
        }

        order = leftPatch.CompareTo(rightPatch);
        if (order != 0)
        {
            return order;
        }

        if (leftLane.Length == 0 || rightLane.Length == 0)
        {
            if (leftLane.Length == rightLane.Length)
            {
                return 0;
            }

            return leftLane.Length == 0 ? 1 : -1;
        }

        var length = Math.Min(leftLane.Length, rightLane.Length);
        for (var index = 0; index < length; index++)
        {
            order = ComparePrereleasePart(leftLane[index], rightLane[index]);
            if (order != 0)
            {
                return order;
            }
        }

        return leftLane.Length.CompareTo(rightLane.Length);
    }

    /// <summary>
    /// The newest release tag in <paramref name="tags"/> (tags carry a leading v, versions do
    /// not), or null when none parses. Mirrors the desktop host, which always follows the newest
    /// release on its lane.
    /// </summary>
    public static string? TryPickNewestTag(IEnumerable<string> tags)
    {
        string? newest = null;
        foreach (var tag in tags)
        {
            var version = tag.StartsWith("v", StringComparison.Ordinal) ? tag[1..] : tag;
            if (!TryParse(version, out _, out _, out _, out _))
            {
                continue;
            }

            if (newest is null || Compare(version, NewestVersion(newest)) > 0)
            {
                newest = tag;
            }
        }

        return newest;
    }

    private static string NewestVersion(string tag)
    {
        return tag.StartsWith("v", StringComparison.Ordinal) ? tag[1..] : tag;
    }

    private static int ComparePrereleasePart(string left, string right)
    {
        var leftNumeric = int.TryParse(left, out var leftNumber);
        var rightNumeric = int.TryParse(right, out var rightNumber);
        if (leftNumeric && rightNumeric)
        {
            return leftNumber.CompareTo(rightNumber);
        }

        if (leftNumeric)
        {
            return -1;
        }

        if (rightNumeric)
        {
            return 1;
        }

        return string.Compare(left, right, StringComparison.Ordinal);
    }

    /// <summary>
    /// Whether <paramref name="version"/> belongs to the restarted numbering: Dahlia began again
    /// at 0.0 after the 0.12 line, so 0.0.x is newer than any 0.12.x install by definition even
    /// though it compares lower.
    /// </summary>
    public static bool IsResetEpochVersion(string? version)
    {
        return TryParse(version, out var major, out var minor, out _, out _)
            && major == 0 && minor == 0;
    }

    /// <summary>
    /// Whether <paramref name="newest"/> should replace <paramref name="current"/>: newer by
    /// semver, or the first release of the reset epoch on an install from before it.
    /// </summary>
    public static bool IsUpdateAvailable(string newest, string current)
    {
        return Compare(newest, current) > 0
            || (IsResetEpochVersion(newest) && !IsResetEpochVersion(current));
    }

    [GeneratedRegex(@"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$")]
    private static partial Regex VersionPattern();
}
