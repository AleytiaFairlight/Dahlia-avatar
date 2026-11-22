using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;

/// <summary>Dahlia: the update state, mirroring the desktop host's AutoUpdaterState status.</summary>
internal enum DahliaUpdateStatus
{
    Disabled,
    Idle,
    Checking,
    Available,
    Downloading,
    Downloaded,
    NotAvailable,
    Error,
}

/// <summary>Dahlia: the release an update check found.</summary>
internal sealed record DahliaUpdateInfo(string Version);

/// <summary>
/// Dahlia: the update mechanism behind <see cref="DahliaAutoUpdate"/>. The service owns the
/// schedule; the source owns checking, downloading, and installing, and reports every state
/// change through <see cref="StateChanged"/>.
/// </summary>
internal interface IDahliaUpdateSource
{
    DahliaUpdateStatus Status { get; }

    DahliaUpdateInfo? Info { get; }

    event Action? StateChanged;

    Task CheckForUpdatesAsync();

    Task DownloadUpdateAsync();

    Task QuitAndInstallAsync();
}

/// <summary>Dahlia: an update source that never updates (development and editor runs).</summary>
internal sealed class DahliaDisabledUpdateSource : IDahliaUpdateSource
{
    public DahliaUpdateStatus Status => DahliaUpdateStatus.Disabled;

    public DahliaUpdateInfo? Info => null;

    public event Action? StateChanged;

    public Task CheckForUpdatesAsync()
    {
        return Task.CompletedTask;
    }

    public Task DownloadUpdateAsync()
    {
        return Task.CompletedTask;
    }

    public Task QuitAndInstallAsync()
    {
        return Task.CompletedTask;
    }
}

internal sealed class DahliaAutoUpdateOptions
{
    /// <summary>Removes old Kirie release files; returns their names. Runs once at start.</summary>
    public Func<Task<IReadOnlyList<string>>>? CleanOldDownloads { get; init; }

    public Action<string>? Logger { get; init; }
}

/// <summary>
/// Dahlia: updates the host without asking. Mirrors
/// apps/stage-tamagotchi/src/main/dahlia-auto-update.ts: the service downloads a new release as
/// soon as one is found, looks for releases every hour, and installs a downloaded release once
/// the computer has had no input for a while. A downloaded update also installs when the app
/// quits (see <see cref="InstallOnQuitIfReady"/>).
/// Godot owns the lifecycle: Main feeds <see cref="Process"/> every frame, tracks the last input
/// in _Input for the idle check, and calls <see cref="InstallOnQuitIfReady"/> on every quit path.
/// </summary>
internal sealed class DahliaAutoUpdate : IDisposable
{
    /// <summary>How often to look for a new release while the host runs.</summary>
    public const double CheckIntervalSeconds = 60 * 60;

    /// <summary>How long the computer must be unused (no input) before the host installs.</summary>
    public const double IdleSecondsThreshold = 10 * 60;

    /// <summary>How often to look whether the computer is idle once an update is downloaded.</summary>
    public const double InstallPollSeconds = 60;

    private readonly IDahliaUpdateSource _source;
    private readonly Func<double> _idleSeconds;
    private readonly Action<string> _logger;
    private readonly Func<Task<IReadOnlyList<string>>>? _cleanOldDownloads;
    private double _checkElapsed;
    private double _installElapsed;
    private bool _installing;
    private bool _disposed;

    public DahliaAutoUpdate(
        IDahliaUpdateSource source,
        Func<double> idleSeconds,
        DahliaAutoUpdateOptions? options = null)
    {
        _source = source;
        _idleSeconds = idleSeconds;
        _logger = options?.Logger ?? (_ => { });
        _cleanOldDownloads = options?.CleanOldDownloads;
    }

    public static DahliaAutoUpdate ForDisabled()
    {
        return new DahliaAutoUpdate(new DahliaDisabledUpdateSource(), () => 0.0);
    }

    /// <summary>
    /// Cleans old downloads once and starts downloading when an update is already available.
    /// Does nothing when updates are off. <see cref="Process"/> drives the schedule after this.
    /// </summary>
    public void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_source.Status == DahliaUpdateStatus.Disabled)
        {
            return;
        }

        if (_cleanOldDownloads is not null)
        {
            Forget(CleanAsync(), "could not clean old Kirie downloads");
        }

        _source.StateChanged += OnSourceStateChanged;
        OnSourceStateChanged();
    }

    /// <summary>
    /// Advances the hourly check timer and the idle-install timer. A downloaded update is
    /// installed by the idle timer; checking again would only find the same release.
    /// </summary>
    public void Process(double delta)
    {
        if (_disposed || _source.Status == DahliaUpdateStatus.Disabled)
        {
            return;
        }

        _checkElapsed += delta;
        if (_checkElapsed >= CheckIntervalSeconds)
        {
            _checkElapsed = 0;
            PollForCheck();
        }

        _installElapsed += delta;
        if (_installElapsed >= InstallPollSeconds)
        {
            _installElapsed = 0;
            PollForInstall();
        }
    }

    /// <summary>
    /// One hourly check, unless an update already waits to be installed.
    /// </summary>
    public void PollForCheck()
    {
        if (_source.Status is DahliaUpdateStatus.Downloaded or DahliaUpdateStatus.Downloading)
        {
            return;
        }

        Forget(_source.CheckForUpdatesAsync(), "update check failed");
    }

    /// <summary>
    /// Installs a downloaded update once the computer is idle, and only once: the flag stays set
    /// because the host quits after the install starts.
    /// </summary>
    public void PollForInstall()
    {
        if (_installing
            || _source.Status != DahliaUpdateStatus.Downloaded
            || _idleSeconds() < IdleSecondsThreshold)
        {
            return;
        }

        _installing = true;
        _logger($"installing {_source.Info?.Version ?? "the update"} while the computer is idle");
        Forget(
            _source.QuitAndInstallAsync(),
            installFailed =>
            {
                _installing = false;
                _logger($"install failed; it runs again when the host quits: {installFailed}");
            },
            "install failed");
    }

    /// <summary>
    /// The quit-install hook: installs a downloaded update when the host quits, and reports
    /// whether an install started. Every quit path (the QuitApp invoke, the tray Quit item) calls
    /// this before quitting the tree.
    /// </summary>
    public bool InstallOnQuitIfReady()
    {
        if (_disposed
            || _installing
            || _source.Status == DahliaUpdateStatus.Disabled
            || _source.Status != DahliaUpdateStatus.Downloaded)
        {
            return false;
        }

        _installing = true;
        Forget(
            _source.QuitAndInstallAsync(),
            installFailed =>
            {
                _installing = false;
                _logger($"install failed: {installFailed}");
            },
            "install failed");
        return true;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.StateChanged -= OnSourceStateChanged;
        if (_source is IDisposable disposable)
        {
            disposable.Dispose();
        }
    }

    private void OnSourceStateChanged()
    {
        // The source shares one download between callers, so a repeated 'available' starts nothing new.
        if (_source.Status == DahliaUpdateStatus.Available)
        {
            _logger($"downloading {_source.Info?.Version ?? "the new release"}");
            Forget(_source.DownloadUpdateAsync(), "download failed; trying again at the next check");
        }
    }

    private async Task CleanAsync()
    {
        var removed = _cleanOldDownloads is not null ? await _cleanOldDownloads() : [];
        if (removed.Count > 0)
        {
            _logger($"removed old Kirie downloads: {string.Join(", ", removed)}");
        }
    }

    private void Forget(Task task, string warning)
    {
        Forget(task, _ => { }, warning);
    }

    private void Forget(Task task, Action<Exception> onFaulted, string warning)
    {
        _ = task.ContinueWith(
            faulted =>
            {
                if (faulted.IsFaulted && faulted.Exception is not null)
                {
                    var error = faulted.Exception.InnerException ?? faulted.Exception;
                    onFaulted(error);
                    _logger($"{warning}: {error.Message}");
                }
            },
            TaskScheduler.Default);
    }
}

/// <summary>
/// Dahlia: the Kirie update mechanism. Asks Dahlia's server first and GitHub when the server
/// doesn't answer (mirroring the desktop host's auto-updater.ts), downloads the staged release
/// files, and records a pending install that the launcher applies when the host quits (see
/// docs/packaging-updates.md).
/// </summary>
internal sealed class DahliaGodotUpdateSource : IDahliaUpdateSource, IDisposable
{
    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(15),
    };

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _currentVersion;
    private readonly string _stagingDirectory;
    private readonly Action<string> _logger;
    private string? _feedBaseUrl;
    private string? _resolvedTag;
    private DahliaUpdateManifest? _pending;
    private bool _installStarted;
    private bool _disposed;

    static DahliaGodotUpdateSource()
    {
        Http.DefaultRequestHeaders.UserAgent.Add(
            new ProductInfoHeaderValue("Dahlia-Kirie", "1"));
        Http.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));
    }

    public DahliaGodotUpdateSource(string currentVersion, string stagingDirectory, Action<string>? logger = null)
    {
        _currentVersion = currentVersion;
        _stagingDirectory = stagingDirectory;
        _logger = logger ?? (_ => { });
        Status = DahliaUpdateStatus.Idle;
    }

    public DahliaUpdateStatus Status { get; private set; }

    public DahliaUpdateInfo? Info { get; private set; }

    public event Action? StateChanged;

    public async Task CheckForUpdatesAsync()
    {
        await _gate.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            SetStatus(DahliaUpdateStatus.Checking, Info);
            var manifest = await ResolveManifestAsync();
            if (DahliaAppVersion.IsUpdateAvailable(manifest.Version, _currentVersion))
            {
                _pending = manifest;
                SetStatus(DahliaUpdateStatus.Available, new DahliaUpdateInfo(manifest.Version));
            }
            else
            {
                _pending = null;
                SetStatus(
                    DahliaUpdateStatus.NotAvailable,
                    new DahliaUpdateInfo(_currentVersion));
            }
        }
        catch (Exception error)
        {
            _logger($"update check failed: {error.Message}");
            SetStatus(DahliaUpdateStatus.Error, Info);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task DownloadUpdateAsync()
    {
        await _gate.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (Status == DahliaUpdateStatus.Downloaded || _pending is null)
            {
                return;
            }

            SetStatus(DahliaUpdateStatus.Downloading, Info);
            Directory.CreateDirectory(_stagingDirectory);
            foreach (var file in _pending.Files)
            {
                var path = Path.Combine(_stagingDirectory, file.Name);
                using var response = await Http.GetAsync(file.Url);
                response.EnsureSuccessStatusCode();
                var bytes = await response.Content.ReadAsByteArrayAsync();
                if (file.Sha512 is not null
                    && !string.Equals(
                        Convert.ToHexString(SHA512.HashData(bytes)),
                        file.Sha512,
                        StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException($"The staged file failed its checksum: {file.Name}");
                }

                await File.WriteAllBytesAsync(path, bytes);
            }

            SetStatus(DahliaUpdateStatus.Downloaded, Info);
        }
        catch (Exception error)
        {
            _logger($"download failed; trying again at the next check: {error.Message}");
            SetStatus(
                _pending is not null ? DahliaUpdateStatus.Available : DahliaUpdateStatus.Error,
                Info);
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task QuitAndInstallAsync()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_installStarted || Status != DahliaUpdateStatus.Downloaded || _pending is null)
        {
            return Task.CompletedTask;
        }

        _installStarted = true;
        // The running export cannot replace itself; the launcher applies the staged release when
        // the host quits (see docs/packaging-updates.md). Until packaging lands, the marker is
        // the install: it records exactly what would be installed.
        Directory.CreateDirectory(_stagingDirectory);
        var marker = JsonSerializer.Serialize(
            new DahliaPendingInstall(_pending.Version, _pending.Files.Select(file => file.Name).ToList()));
        File.WriteAllText(Path.Combine(_stagingDirectory, "pending-install.json"), marker);
        _logger($"staged {_pending.Version} for install on quit");
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _gate.Dispose();
    }

    private async Task<DahliaUpdateManifest> ResolveManifestAsync()
    {
        string tag;
        string feedBase;
        try
        {
            var serverReleases = await FetchServerReleasesAsync();
            var serverTag = DahliaUpdateFeed.SelectNewestTagWithAsset(serverReleases, DahliaUpdateFeed.KirieUpdateFile);
            if (serverTag is null)
            {
                throw new InvalidDataException("Dahlia's server listed no finished release");
            }

            tag = serverTag;
            feedBase = DahliaUpdateFeed.FeedUrlForRelease(
                serverReleases,
                tag,
                DahliaUpdateFeed.KirieUpdateFile,
                $"{DahliaUpdateFeed.GitHubReleaseDownloadBaseUrl}/{tag}");
        }
        catch (Exception error)
        {
            // A failed lookup keeps checking the release found before.
            if (_feedBaseUrl is not null && _resolvedTag is not null)
            {
                _logger($"release lookup failed, checking {_resolvedTag} again: {error.Message}");
                return await FetchManifestAsync($"{_feedBaseUrl}/{DahliaUpdateFeed.KirieUpdateFile}");
            }

            // Dahlia's server didn't answer: ask GitHub, like the desktop host.
            var githubTag = await FetchNewestGitHubTagAsync();
            if (githubTag is null)
            {
                throw new InvalidDataException(
                    $"No release found for the update feed: {error.Message}");
            }

            tag = githubTag;
            feedBase = $"{DahliaUpdateFeed.GitHubReleaseDownloadBaseUrl}/{tag}";
        }

        var manifest = await FetchManifestAsync($"{feedBase}/{DahliaUpdateFeed.KirieUpdateFile}");
        _resolvedTag = tag;
        _feedBaseUrl = feedBase;
        return manifest;
    }

    private static async Task<IReadOnlyList<DahliaServerRelease>> FetchServerReleasesAsync()
    {
        using var response = await Http.GetAsync(DahliaUpdateFeed.ServerReleasesUrl);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidDataException(
                $"Dahlia's server answered {response.StatusCode}");
        }

        using var payload = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync());
        var releases = DahliaUpdateFeed.ParseReleases(payload.RootElement);
        if (releases.Count == 0)
        {
            throw new InvalidDataException("Dahlia's server listed no releases");
        }

        return releases;
    }

    private static async Task<string?> FetchNewestGitHubTagAsync()
    {
        try
        {
            using var response = await Http.GetAsync(DahliaUpdateFeed.GitHubReleasesApiUrl);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            using var payload = await JsonDocument.ParseAsync(
                await response.Content.ReadAsStreamAsync());
            return DahliaUpdateFeed.SelectNewestTagWithAsset(
                DahliaUpdateFeed.ParseReleases(payload.RootElement),
                DahliaUpdateFeed.KirieUpdateFile);
        }
        catch
        {
            return null;
        }
    }

    private static async Task<DahliaUpdateManifest> FetchManifestAsync(string url)
    {
        using var response = await Http.GetAsync(url);
        response.EnsureSuccessStatusCode();
        using var payload = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync());
        return DahliaUpdateManifest.Parse(payload.RootElement, url);
    }

    private void SetStatus(DahliaUpdateStatus status, DahliaUpdateInfo? info)
    {
        Status = status;
        Info = info;
        foreach (var listener in StateChanged?.GetInvocationList() ?? [])
        {
            try
            {
                ((Action)listener)();
            }
            catch (Exception error)
            {
                _logger($"Failed to notify update listener: {error.Message}");
            }
        }
    }
}

/// <summary>Dahlia: one staged file in the Kirie update manifest.</summary>
internal sealed record DahliaUpdateManifestFile(string Name, string Url, string? Sha512);

/// <summary>
/// Dahlia: the Kirie update manifest (kirie-latest-x64.json) carried by every release.
/// Version 0.12.2-beta.9 files: {"version", "files": [{"name", "url", "sha512"?}], "releaseDate"?}.
/// </summary>
internal sealed record DahliaUpdateManifest(
    string Version,
    IReadOnlyList<DahliaUpdateManifestFile> Files)
{
    public static DahliaUpdateManifest Parse(JsonElement payload, string url)
    {
        if (payload.ValueKind != JsonValueKind.Object
            || !payload.TryGetProperty("version", out var versionElement)
            || versionElement.ValueKind != JsonValueKind.String
            || !payload.TryGetProperty("files", out var filesElement)
            || filesElement.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException($"The update manifest has an unexpected shape: {url}");
        }

        var version = versionElement.GetString();
        if (version is null
            || !DahliaAppVersion.TryParse(version, out _, out _, out _, out _))
        {
            throw new InvalidDataException($"The update manifest names no version: {url}");
        }

        var files = new List<DahliaUpdateManifestFile>();
        foreach (var entry in filesElement.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object
                || !entry.TryGetProperty("name", out var nameElement)
                || nameElement.ValueKind != JsonValueKind.String
                || !entry.TryGetProperty("url", out var urlElement)
                || urlElement.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var name = nameElement.GetString();
            var fileUrl = urlElement.GetString();
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(fileUrl))
            {
                continue;
            }

            string? sha = null;
            if (entry.TryGetProperty("sha512", out var shaElement)
                && shaElement.ValueKind == JsonValueKind.String)
            {
                sha = shaElement.GetString();
            }

            files.Add(new DahliaUpdateManifestFile(name, fileUrl, sha));
        }

        if (files.Count == 0)
        {
            throw new InvalidDataException($"The update manifest lists no files: {url}");
        }

        return new DahliaUpdateManifest(version, files);
    }
}

/// <summary>Dahlia: what the launcher applies when the host quits (see docs/packaging-updates.md).</summary>
internal sealed record DahliaPendingInstall(string Version, List<string> Files);
