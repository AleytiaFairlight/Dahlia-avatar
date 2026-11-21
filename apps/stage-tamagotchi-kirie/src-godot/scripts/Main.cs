using System.IO;

using Eventa;
using GdKirie.EventaAdapter;
using GdKirie.Notifications;
using GdKirie.Platform;
using GdKirie.Tray;
using Godot;

public partial class Main : Node
{
    private const string PageUrl = "res://src-web/dist/index.html";
    private const string DevWebUrlOption = "kirie-web-url";

    private KirieClient? _kirie;
    private KirieEventaContextHandle? _eventa;
    private GdKiriePlatformHost? _platform;
    private GdKirieNotificationsHost? _notifications;
    private OnboardingWindowManager? _onboarding;
    private SettingsWindowManager? _settings;
    private ChatWindowManager? _chat;
    private WidgetWindowManager? _widgets;
    private SpotlightHost? _spotlight;
    private NoticeWindowManager? _notice;
    private TrayHost? _tray;
    private IDisposable? _trayLabelsRegistration;
    private DeveloperToolsService? _developerTools;
    private IDisposable? _developerToolsRegistration;
    private IDisposable? _displaySnapshotRegistration;
    private DahliaWindowService? _dahliaWindows;
    private DahliaScreenCaptureService? _dahliaScreen;
    private DahliaSceneModelService? _dahliaScene;
    private DahliaGameLauncherService? _dahliaLauncher;
    private WebViewPermissionHandler? _permissions;
    private MicrophonePermissionService? _microphonePermissions;
    private IDisposable? _microphonePermissionRegistration;
    private DahliaErrorReports? _errorReports;
    private IDisposable? _errorReportsRegistration;
    private IDisposable? _dahliaPowerShellRegistration;
    private IDisposable? _dahliaDeviceRegistration;
    private IDisposable? _dahliaPcStateRegistration;
    private DahliaGhostCursorService? _dahliaGhostCursor;
    private IDisposable? _dahliaNetworkScanRegistration;
    private IDisposable? _dahliaSshRegistration;
    private DahliaWorkflowBrowserService? _dahliaWorkflow;
    private DahliaWindowRecoveryTracker? _windowRecovery;
    private IDisposable? _quitRegistration;
    private NativeWindowResizeController? _nativeResize;
    private DahliaAutoUpdate? _autoUpdate;
    private ulong _lastInputTicksMsec;

    public override void _Ready()
    {
        var window = GetWindow();
        DesktopWindowSizing.ApplyInitialDisplayScale(window);
        _nativeResize = new NativeWindowResizeController(window);
        _kirie = KirieClient.FromNode(GetNode("KirieNode"));
        if (!_kirie.IsAvailable)
        {
            GD.PushError("Kirie is unavailable on this platform.");
            return;
        }

        var registry = ChatWindowContracts.Register(
            WidgetContracts.Register(
                AiriDesktopContracts.Register(
                    DahliaContracts.Register(
                    GdKirieNotifications.Register(
                        GdKiriePlatform.Register(new KirieEventaJsonRegistry()))))));
        _eventa = _kirie.CreateEventaContext(registry);
        _platform = GdKiriePlatform.Attach(_eventa.Context, window);
        _notifications = GdKirieNotifications.Attach(_eventa.Context, window);
        _displaySnapshotRegistration = CurrentDisplaySnapshotService.Attach(
            _eventa.Context,
            window);
        // Dahlia's vision and game parity: the window helper (find/capture/tap/peek/
        // watch-events), whole-screen screenshots, the scene model files and the game
        // launcher. Each service answers its channel on non-Windows with an explanation.
        _dahliaWindows = DahliaWindowService.Attach(_eventa.Context, () => new[] { window });
        _dahliaScreen = DahliaScreenCaptureService.Attach(_eventa.Context, () => _dahliaWindows.Helper);
        _dahliaScene = DahliaSceneModelService.Attach(_eventa.Context);
        _dahliaLauncher = DahliaGameLauncherService.Attach(_eventa.Context);
        _microphonePermissions = new MicrophonePermissionService();
        _microphonePermissionRegistration = _microphonePermissions.Attach(
            _eventa.Context,
            ownsPrompt: true);
        // Dahlia: host errors wait in user://dahlia-error-reports.jsonl until
        // a window takes them (dahlia-error-reports.cs), like Electron's
        // dahlia-error-reports.ts. Nothing goes to Sentry.
        _errorReports = new DahliaErrorReports(
            OS.GetUserDataDir(),
            OS.GetName(),
            DahliaErrorReports.ReadAppVersion());
        _errorReportsRegistration = _errorReports.Attach(_eventa.Context);
        // Dahlia: the storage guard runs before any window opens
        // (dahlia-storage-guard-service.cs), and the file server entry is
        // refreshed before the MCP servers start (dahlia-files-service.cs).
        DahliaStorageGuard.Guard(OS.GetUserDataDir());
        DahliaFilesService.Ensure(
            OS.GetUserDataDir(),
            OS.GetExecutablePath(),
            Path.Combine(
                Path.GetDirectoryName(OS.GetExecutablePath()) ?? string.Empty,
                "dahlia-files-mcp.mjs"));
        // Dahlia: her system tools for her other devices (PowerShell, the host
        // name, and the PC state). The window recovery tracker stands ready for
        // a webview crash signal, which the host exposes none of yet.
        _dahliaPowerShellRegistration = DahliaPowerShellService.Attach(_eventa.Context);
        _dahliaDeviceRegistration = DahliaDeviceService.Attach(_eventa.Context);
        _dahliaPcStateRegistration = DahliaPcStateService.Attach(
            _eventa.Context,
            new DahliaPcStateDeps { OwnFocused = window.HasFocus });
        // Dahlia: her ghost cursor (backseat pointing), the local network
        // scanner, SSH from this PC, and her ticket-workflow browser
        // (dahlia-ghost-cursor.cs, dahlia-network-scan.cs, dahlia-ssh.cs,
        // dahlia-workflow-browser.cs). The cursor needs a window of this
        // host; the browser steps answer that Chrome needs its own host.
        _dahliaGhostCursor = DahliaGhostCursorService.Attach(_eventa.Context, this);
        _dahliaNetworkScanRegistration = DahliaNetworkScanService.Attach(_eventa.Context);
        _dahliaSshRegistration = DahliaSshService.Attach(_eventa.Context);
        _dahliaWorkflow = DahliaWorkflowBrowserService.Attach(_eventa.Context);
        _windowRecovery = new DahliaWindowRecoveryTracker();
        _quitRegistration = _eventa.Context.RegisterInvokeHandler(
            AiriDesktopEvents.QuitApp,
            (EmptyPayload _, CancellationToken _) =>
            {
                QuitApplication();
                return Task.FromResult(new EmptyPayload());
            });

        _kirie.WebViewReady += OnWebViewReady;
        _kirie.IpcError += OnIpcError;
        _eventa.Adapter.Error += OnEventaError;

        string initialUrl;
        AboutWindowManager about;
        try
        {
            var rendererUrl = ResolveInitialUrl();
            // Dahlia: the app loads only Dahlia's server, its own updates,
            // and itself (dahlia-network-service.cs), like Electron's
            // restrictNetworkToDahlia().
            if (!DahliaNetworkService.IsAllowedNavigation(rendererUrl))
            {
                DahliaNetworkService.LogBlocked(rendererUrl);
                GD.PushError($"Dahlia blocked the startup URL: {rendererUrl}.");
                return;
            }

            initialUrl = RendererUrl.ForMain(rendererUrl);
            _permissions = new WebViewPermissionHandler(
                _kirie,
                rendererUrl,
                _microphonePermissions);
            _widgets = new WidgetWindowManager(_eventa.Context, this, window,
                registry, rendererUrl, _microphonePermissions);
            _developerTools = new DeveloperToolsService(
                this,
                GetWindow(),
                registry,
                rendererUrl,
                _microphonePermissions,
                _widgets);
            _developerToolsRegistration = _developerTools.Attach(_eventa.Context);
            _onboarding = new OnboardingWindowManager(
                _eventa.Context,
                this,
                GetWindow(),
                registry,
                rendererUrl,
                _microphonePermissions);
            _chat = new ChatWindowManager(
                _eventa.Context,
                this,
                GetWindow(),
                registry,
                rendererUrl,
                _microphonePermissions,
                // A chat window opens only after this method returns, so the settings manager
                // below exists by then.
                chatContext => _settings?.Attach(chatContext)
                    ?? throw new InvalidOperationException(
                        "The settings window manager is unavailable."));
            _spotlight = new SpotlightHost(
                _eventa.Context,
                this,
                GetWindow(),
                registry,
                rendererUrl,
                _microphonePermissions,
                _chat);
            _settings = new SettingsWindowManager(
                _eventa.Context,
                this,
                GetWindow(),
                registry,
                rendererUrl,
                _microphonePermissions,
                _developerTools,
                _spotlight,
                _widgets);
            about = new AboutWindowManager(
                this,
                window,
                registry,
                rendererUrl,
                _microphonePermissions);
            _notice = new NoticeWindowManager(
                _eventa.Context,
                this,
                GetWindow(),
                registry,
                rendererUrl,
                _microphonePermissions);
        }
        catch (InvalidOperationException error)
        {
            GD.PushError(error.Message);
            return;
        }

        try
        {
            _tray = new TrayHost(
                this,
                window,
                _settings,
                about,
                QuitApplication);
        }
        catch (Exception error) when (error is TrayException or InvalidOperationException)
        {
            // The application stays usable without a tray, for example on Linux without
            // a StatusNotifierItem host.
            GD.PushError($"The system tray is unavailable: {error.Message}");
        }

        // The main renderer awaits this invoke, and an unanswered invoke never settles.
        // Answer it also when the platform has no tray.
        _trayLabelsRegistration = _eventa.Context.RegisterInvokeHandler(
            AiriDesktopEvents.SetTrayLabels,
            (TrayLabelsPayload labels, CancellationToken _) =>
            {
                _tray?.ApplyLabels(labels);
                return Task.FromResult(new EmptyPayload());
            });

        // Dahlia: the host updates itself (dahlia-auto-update.ts parity). Development and editor
        // runs never check; packaged runs stage releases and install them idle or on quit.
        _lastInputTicksMsec = Time.GetTicksMsec();
        _autoUpdate = CreateDahliaAutoUpdate();

        GD.Print($"create_webview initial_url={initialUrl}");
        _kirie.CreateWebView(initialUrl);
    }

    public override void _Input(InputEvent inputEvent)
    {
        // Any input resets the update idle timer (the Electron host reads the system idle time;
        // the closest Godot equivalent is the last input the host saw).
        _lastInputTicksMsec = Time.GetTicksMsec();
        _nativeResize?.HandleInput(inputEvent);
    }

    public override void _ExitTree()
    {
        _autoUpdate?.Dispose();
        _nativeResize?.Dispose();
        _trayLabelsRegistration?.Dispose();
        _tray?.Dispose();
        _quitRegistration?.Dispose();
        _displaySnapshotRegistration?.Dispose();
        _dahliaLauncher?.Dispose();
        _dahliaScene?.Dispose();
        _dahliaScreen?.Dispose();
        _dahliaWindows?.Dispose();
        _notice?.Dispose();
        _spotlight?.Dispose();
        _widgets?.Dispose();
        _chat?.Dispose();
        _settings?.Dispose();
        _onboarding?.Dispose();
        _developerToolsRegistration?.Dispose();
        _developerTools?.Dispose();
        _microphonePermissions?.Dispose();
        _microphonePermissionRegistration?.Dispose();
        _errorReportsRegistration?.Dispose();
        _errorReports?.Dispose();
        _dahliaPowerShellRegistration?.Dispose();
        _dahliaDeviceRegistration?.Dispose();
        _dahliaPcStateRegistration?.Dispose();
        _dahliaGhostCursor?.Dispose();
        _dahliaNetworkScanRegistration?.Dispose();
        _dahliaSshRegistration?.Dispose();
        _dahliaWorkflow?.Dispose();
        _permissions?.Dispose();
        _notifications?.Dispose();
        _platform?.Dispose();
        _eventa?.Dispose();
        _kirie?.Dispose();
    }

    public override void _Process(double delta)
    {
        _autoUpdate?.Process(delta);
        _widgets?.Process();
        _chat?.Process();
        _tray?.Process();
        _microphonePermissions?.Process();
    }

    private void QuitApplication()
    {
        // A downloaded update installs when the host quits (dahlia-auto-update.ts parity:
        // autoInstallOnAppQuit). The install stages first; the tree quits either way.
        _autoUpdate?.InstallOnQuitIfReady();
        GetTree().Quit();
    }

    private DahliaAutoUpdate CreateDahliaAutoUpdate()
    {
        if (OS.IsDebugBuild())
        {
            // Development and editor runs never check: updates are off, as in the Electron host.
            return DahliaAutoUpdate.ForDisabled();
        }

        var currentVersion = DahliaErrorReports.ReadAppVersion() ?? "0.0.0";
        var service = new DahliaAutoUpdate(
            new DahliaGodotUpdateSource(
                currentVersion,
                Path.Combine(OS.GetUserDataDir(), "updates"),
                GD.Print),
            () => (Time.GetTicksMsec() - _lastInputTicksMsec) / 1000.0,
            new DahliaAutoUpdateOptions
            {
                Logger = GD.Print,
                CleanOldDownloads = () => DahliaUpdateCleanup.CleanOldKirieDownloadsAsync(
                    OS.GetSystemDir(OS.SystemDir.Downloads),
                    currentVersion),
            });
        service.Start();
        return service;
    }

    private string ResolveInitialUrl()
    {
        var launchUrl = _kirie!.GetLaunchOption(DevWebUrlOption).Trim();
        if (launchUrl.Length > 0)
        {
            return launchUrl;
        }

        var environmentUrl = OS.GetEnvironment("KIRIE_WEB_URL").Trim();
        return environmentUrl.Length > 0 ? environmentUrl : PageUrl;
    }

    private static void OnWebViewReady()
    {
        GD.Print("signal webview_ready");
    }

    private void OnIpcError(string error)
    {
        _errorReports?.Queue("ipc-error", $"Kirie IPC error: {error}");
        GD.PushError($"Kirie IPC error: {error}");
    }

    private void OnEventaError(KirieEventaError error)
    {
        _errorReports?.Queue("eventa-error", $"Kirie Eventa error: {error.Message}");
        GD.PushError($"Kirie Eventa error: {error.Message}");
    }
}
