using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

internal static class Program
{
    private static int Main()
    {
        try
        {
            TestsWidgetWirePayloads();
            TestsDesktopWindowGeometry();
            TestsFloatingChatPlacement();
            TestsTrayWindowGeometry();
            TestsSpotlightShortcutPolicy();
            TestsNativeResizeEdges();
            TestsOnboardingTitleBarDragRegion();
            TestsRendererUrlFollowerRuntime();
            TestsCefInspectorTargetSelection();
            TestsCefInspectorRequiresLeader();
            TestsDahliaWindowTitleRank();
            TestsDahliaGameLauncherNames();
            TestsDahliaRecordingFileName();
            TestsDahliaScreenRecordingOps();
            TestsDahliaEventIds();
            TestsMicrophonePermissionPromptCoalescing();
            TestsMicrophonePermissionPersistencePolicy();
            TestsMicrophonePermissionPromptTimeout();
            TestsMicrophonePermissionShutdown();
            TestsDahliaNetworkAllowlist();
            TestsDahliaErrorReportQueue();
            TestsDahliaAppVersion();
            TestsDahliaUpdateFeed();
            TestsDahliaUpdateCleanup();
            TestsDahliaAutoUpdate();
            TestsDahliaUpdateManifest();
            TestsDahliaPowerShellArguments();
            TestsDahliaPowerShellRefusals();
            TestsDahliaGhostCursor();
            TestsDahliaNetworkScan();
            TestsDahliaSsh();
            TestsDahliaWorkflow();
            TestsDahliaFilesServer();
            TestsDahliaPcState();
            TestsDahliaStorageGuard();
            TestsDahliaWindowRecovery();
            TestsDahliaLogging();
            Console.WriteLine("StageTamagotchiKirie.Tests passed.");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
    }

    private static void TestsWidgetWirePayloads()
    {
        const string json = """
            {"id":"weather-test","componentName":"weather","componentProps":{"city":"Tokyo"},
            "alwaysOnTop":true,"size":"m","windowSize":{"width":620,"height":760},"ttlMs":1000}
            """;
        WidgetMutationPayload payload = JsonSerializer.Deserialize(
            json, WidgetJsonContext.Default.WidgetMutationPayload)!;
        AssertEqual("Tokyo", payload.ComponentProps!["city"].GetString(), "widget props from renderer");
        AssertEqual(1000d, payload.TtlMs, "widget expiry in milliseconds");
        AssertEqual(620, payload.WindowSize!.Width, "widget logical width");

        WidgetMutationPayload partial = JsonSerializer.Deserialize(
            "{\"id\":\"weather-test\",\"alwaysOnTop\":false}",
            WidgetJsonContext.Default.WidgetMutationPayload)!;
        AssertEqual<double?>(null, partial.TtlMs, "omitted update keeps its expiry");
        AssertEqual(false, partial.AlwaysOnTop, "explicit unpin survives deserialization");

        var snapshot = new WidgetSnapshotPayload(
            payload.Id!, payload.ComponentName!, payload.ComponentProps!, true,
            payload.Size!.Value, payload.WindowSize, payload.TtlMs!.Value);
        using JsonDocument serialized = JsonDocument.Parse(JsonSerializer.Serialize(
            snapshot, WidgetJsonContext.Default.WidgetSnapshotPayload));
        AssertEqual("weather-test", serialized.RootElement.GetProperty("id").GetString(), "snapshot id");
        AssertEqual("m", serialized.RootElement.GetProperty("size").GetString(), "snapshot grid size");
        AssertEqual("Tokyo", serialized.RootElement.GetProperty("componentProps").GetProperty("city").GetString(), "snapshot props");
    }

    private static void TestsMicrophonePermissionPromptCoalescing()
    {
        // ROOT CAUSE:
        //
        // CEF can issue concurrent requests while one AIRI permission prompt is open.
        // Showing one modal per raw request creates conflicting decisions and exposes
        // native request identifiers to the renderer.
        //
        // We fixed this by keeping native requests in one host-owned prompt generation.
        using var permissions = new MicrophonePermissionCoordinator(
            MicrophonePermissionState.NotDetermined,
            TimeSpan.FromMinutes(2));
        var decisions = new List<bool>();

        var prompt = permissions.Request(decisions.Add, 10);
        var duplicatePrompt = permissions.Request(decisions.Add, 20);

        AssertEqual(true, prompt is not null, "first microphone permission prompt");
        AssertEqual<MicrophonePermissionPromptPayload?>(
            null,
            duplicatePrompt,
            "coalesced microphone permission prompt");
        permissions.Resolve(prompt!.PromptId, MicrophonePermissionState.Granted);
        AssertEqual("True,True", string.Join(',', decisions), "coalesced permission decisions");
    }

    private static void TestsMicrophonePermissionPersistencePolicy()
    {
        using var permissions = new MicrophonePermissionCoordinator(
            MicrophonePermissionState.Denied,
            TimeSpan.FromMinutes(2));
        bool? decision = null;

        var prompt = permissions.Request(value => decision = value, 10);

        AssertEqual<MicrophonePermissionPromptPayload?>(
            null,
            prompt,
            "persisted denial prompt");
        AssertEqual(false, decision, "persisted denial decision");

        permissions.Reset();
        prompt = permissions.Request(value => decision = value, 20);
        AssertEqual(true, prompt is not null, "prompt after permission reset");
    }

    private static void TestsMicrophonePermissionPromptTimeout()
    {
        using var permissions = new MicrophonePermissionCoordinator(
            MicrophonePermissionState.NotDetermined,
            TimeSpan.FromMilliseconds(100));
        bool? decision = null;
        var prompt = permissions.Request(value => decision = value, 10);

        AssertEqual<string?>(null, permissions.Expire(109), "permission prompt before timeout");
        AssertEqual(prompt!.PromptId, permissions.Expire(110), "expired permission prompt");
        AssertEqual(false, decision, "expired permission decision");
        AssertEqual(
            MicrophonePermissionState.NotDetermined,
            permissions.State,
            "permission state after timeout");
    }

    private static void TestsMicrophonePermissionShutdown()
    {
        var permissions = new MicrophonePermissionCoordinator(
            MicrophonePermissionState.NotDetermined,
            TimeSpan.FromMinutes(2));
        bool? decision = null;
        permissions.Request(value => decision = value, 10);

        permissions.Dispose();

        AssertEqual(false, decision, "permission decision during shutdown");
    }

    private static void TestsDesktopWindowGeometry()
    {
        // ROOT CAUSE:
        //
        // Godot's ScreenGetScale returns 1 on Windows even when the desktop uses
        // high-DPI scaling, and MoveToCenter includes reserved system UI areas.
        //
        // We fixed this by deriving the Windows scale from native DPI and centering
        // the decorated frame inside ScreenGetUsableRect.
        AssertEqual(
            1.5f,
            DesktopWindowSizing.ResolveDisplayScale("Windows", 1.0f, 144),
            "Windows display scale");
        AssertEqual(
            1.25f,
            DesktopWindowSizing.ResolveDisplayScale("Wayland", 1.25f, 0),
            "Wayland display scale");
        AssertEqual(
            new Vector2I(405, 215),
            DesktopWindowSizing.ResolveUsableCenter(
                new Rect2I(0, 25, 1200, 800),
                new Vector2I(400, 400),
                new Vector2I(5, -10)),
            "usable-area decorated center");
        AssertEqual(
            new Vector2I(240, 201),
            DesktopWindowSizing.ResolveSpotlightPosition(
                new Rect2I(0, 25, 1200, 800),
                new Vector2I(720, 100)),
            "spotlight slot");
    }

    private static void TestsFloatingChatPlacement()
    {
        var workArea = new Rect2I(0, 25, 1920, 1055);
        var chatSize = new Vector2I(360, 520);
        var leftBottom = AttachedChatLayout.Preferred;
        var rightBottom = new AttachedChatLayout(AttachedChatSide.Right, AttachedChatAnchor.Bottom);
        var leftTop = new AttachedChatLayout(AttachedChatSide.Left, AttachedChatAnchor.Top);

        AssertEqual(
            AttachedChatSide.Right,
            FloatingChatPlacement.ChooseAttachedLayout(
                new Rect2I(100, 300, 450, 600), chatSize, workArea, leftBottom, 24).Side,
            "attached chat moves right without room on the left");
        AssertEqual(
            AttachedChatSide.Right,
            FloatingChatPlacement.ChooseAttachedLayout(
                new Rect2I(370, 300, 450, 600), chatSize, workArea, rightBottom, 24).Side,
            "attached chat stays right until the left has room to spare");
        AssertEqual(
            AttachedChatSide.Left,
            FloatingChatPlacement.ChooseAttachedLayout(
                new Rect2I(400, 300, 450, 600), chatSize, workArea, rightBottom, 24).Side,
            "attached chat returns left with room to spare");
        AssertEqual(
            AttachedChatAnchor.Top,
            FloatingChatPlacement.ChooseAttachedLayout(
                new Rect2I(1000, 25, 450, 300), chatSize, workArea, leftBottom, 24).Anchor,
            "attached chat lines up with the top near the top of the work area");
        AssertEqual(
            AttachedChatAnchor.Top,
            FloatingChatPlacement.ChooseAttachedLayout(
                new Rect2I(1000, 250, 450, 300), chatSize, workArea, leftTop, 24).Anchor,
            "attached chat stays top anchored until the bottom has room to spare");
        AssertEqual(
            AttachedChatAnchor.Bottom,
            FloatingChatPlacement.ChooseAttachedLayout(
                new Rect2I(1000, 280, 450, 300), chatSize, workArea, leftTop, 24).Anchor,
            "attached chat returns to the bottom anchor with room to spare");
        AssertEqual(
            AttachedChatSide.Left,
            FloatingChatPlacement.ChooseAttachedLayout(
                new Rect2I(380, 300, 1300, 600), chatSize, workArea, rightBottom, 24).Side,
            "attached chat goes back left when neither side has room to spare");

        AssertEqual(
            new Vector2I(-360, 80),
            FloatingChatPlacement.AttachedOffset(
                new Rect2I(1000, 300, 450, 600), chatSize, workArea, leftBottom),
            "left bottom attached offset");
        AssertEqual(
            new Vector2I(450, 0),
            FloatingChatPlacement.AttachedOffset(
                new Rect2I(100, 25, 450, 300),
                chatSize,
                workArea,
                new AttachedChatLayout(AttachedChatSide.Right, AttachedChatAnchor.Top)),
            "right top attached offset");
        AssertEqual(
            new Vector2I(-100, 0),
            FloatingChatPlacement.AttachedOffset(
                new Rect2I(100, 25, 450, 300), chatSize, workArea, leftBottom),
            "attached offset without room stays in the work area");
        AssertEqual(
            "n,w,nw",
            string.Join(',', FloatingChatPlacement.AttachedResizeEdges(leftBottom)),
            "left bottom attached resize edges");

        DisplayArea[] displays =
        [
            new(new Rect2I(0, 0, 1920, 1080), workArea),
            new(new Rect2I(-1280, 0, 1280, 800), new Rect2I(-1280, 0, 1280, 800)),
        ];
        AssertEqual(
            new Rect2I(600, 25, 380, 560),
            FloatingChatPlacement.KeepOnDisplay(new Rect2I(600, -200, 380, 560), displays),
            "floating chat top edge stays below the menu bar");
        AssertEqual(
            new Rect2I(-380, 240, 380, 560),
            FloatingChatPlacement.KeepOnDisplay(new Rect2I(-300, 600, 380, 560), displays),
            "floating chat moves onto the display that holds most of it");
        AssertEqual(
            new Rect2I(-1280, 0, 1280, 800),
            FloatingChatPlacement.KeepOnDisplay(new Rect2I(-1280, 0, 1400, 1000), displays),
            "floating chat larger than the work area shrinks to it");

        AssertEqual(
            new Rect2I(80, 70, 420, 530),
            FloatingChatPlacement.ResizeByDelta(
                new Rect2I(100, 100, 400, 500), new Vector2I(-20, -30), "nw", new Vector2I(300, 260)),
            "floating chat resize from the top-left corner");
        AssertEqual(
            new Rect2I(200, 100, 300, 500),
            FloatingChatPlacement.ResizeByDelta(
                new Rect2I(100, 100, 400, 500), new Vector2I(250, 0), "w", new Vector2I(300, 260)),
            "floating chat resize stops at the minimum width");
    }

    private static void TestsTrayWindowGeometry()
    {
        var workArea = new Rect2I(0, 25, 1200, 800);
        AssertEqual(
            new Vector2I(900, 1200),
            TrayWindowGeometry.ResolvePresetSize(TrayWindowSizePreset.Recommended, workArea, 2.0f),
            "recommended size uses physical pixels");
        AssertEqual(
            new Vector2I(600, 800),
            TrayWindowGeometry.ResolvePresetSize(TrayWindowSizePreset.FullHeight, workArea, 2.0f),
            "full height keeps the recommended aspect ratio");
        AssertEqual(
            new Vector2I(300, 400),
            TrayWindowGeometry.ResolvePresetSize(TrayWindowSizePreset.HalfHeight, workArea, 2.0f),
            "half height keeps the recommended aspect ratio");
        AssertEqual(
            new Rect2I(800, 425, 300, 400),
            TrayWindowGeometry.ResolveAnchoredBounds(
                new Rect2I(500, 225, 600, 600),
                new Vector2I(300, 400),
                workArea),
            "resize keeps the bottom-right edges in the bottom-right quadrant");
        AssertEqual(
            new Rect2I(0, 25, 450, 800),
            TrayWindowGeometry.ResolveAnchoredBounds(
                new Rect2I(-50, 0, 400, 400),
                new Vector2I(450, 1000),
                workArea),
            "resize stays inside the work area");
        AssertEqual(
            new Vector2I(750, 25),
            TrayWindowGeometry.ResolveAlignedPosition(
                TrayWindowAlignment.TopRight,
                workArea,
                new Vector2I(450, 600)),
            "top-right alignment");
        AssertEqual(
            new Vector2I(375, 125),
            TrayWindowGeometry.ResolveAlignedPosition(
                TrayWindowAlignment.Center,
                workArea,
                new Vector2I(450, 600)),
            "center alignment");
        AssertEqual(
            true,
            TrayWindowGeometry.IsPositionMatch(new Vector2I(754, 21), new Vector2I(750, 25)),
            "position match tolerance");
        AssertEqual(
            false,
            TrayWindowGeometry.IsSizeMatch(new Vector2I(453, 600), new Vector2I(450, 600)),
            "size match tolerance");
    }

    private static void TestsSpotlightShortcutPolicy()
    {
        AssertEqual(
            true,
            SpotlightHost.IsSafe(SpotlightHost.Default),
            "default Spotlight shortcut");
        AssertEqual(
            false,
            SpotlightHost.IsSafe(new SpotlightAcceleratorPayload("KeyA", ["shift"])),
            "shift-only Spotlight shortcut");
        AssertEqual(
            true,
            SpotlightHost.IsSafe(new SpotlightAcceleratorPayload("KeyK", ["cmd"])),
            "cmd Spotlight shortcut");
        AssertEqual(
            false,
            SpotlightHost.IsSafe(new SpotlightAcceleratorPayload("", ["ctrl"])),
            "empty-key Spotlight shortcut");
        AssertEqual(
            "KeyA",
            SpotlightHost.TryCreate("KeyA", "ctrl, shift")!.Key,
            "Spotlight modifier parse");
        AssertEqual<SpotlightAcceleratorPayload?>(
            null,
            SpotlightHost.TryCreate("KeyA", "shift"),
            "unsafe persisted Spotlight shortcut");
    }

    private static void TestsOnboardingTitleBarDragRegion()
    {
        var windowSize = new Vector2I(1000, 650);
        var safeTitleMargins = new Vector3I(80, 12, 32);

        // ROOT CAUSE:
        //
        // Godot CEF does not process Electron CSS drag regions. The renderer then
        // started window movement from a DOM mouse event instead of native input.
        //
        // We fixed this by using the safe native title region from Godot WindowInput.
        AssertEqual(
            true,
            OnboardingWindow.IsInSafeTitleRegion(
                new Vector2(80, 0),
                windowSize,
                safeTitleMargins),
            "onboarding safe title region");
        AssertEqual(
            false,
            OnboardingWindow.IsInSafeTitleRegion(
                new Vector2(79, 16),
                windowSize,
                safeTitleMargins),
            "onboarding traffic-light region");
        AssertEqual(
            false,
            OnboardingWindow.IsInSafeTitleRegion(
                new Vector2(988, 16),
                windowSize,
                safeTitleMargins),
            "onboarding right title margin");
        AssertEqual(
            false,
            OnboardingWindow.IsInSafeTitleRegion(
                new Vector2(500, 32),
                windowSize,
                safeTitleMargins),
            "onboarding content region");
    }

    private static void TestsNativeResizeEdges()
    {
        var size = new Vector2I(450, 600);

        // ROOT CAUSE:
        //
        // The Kirie renderer used DOM elements to detect window resize edges. That kept
        // fixed native-window geometry in CEF and made Godot depend on Web mouse events.
        //
        // We fixed this by resolving each edge from Godot WindowInput coordinates.
        AssertEqual(
            DisplayServer.WindowResizeEdge.TopLeft,
            NativeWindowResizeController.ResolveResizeEdge(new Vector2(8, 8), size, 5, 10),
            "top-left resize edge");
        AssertEqual(
            DisplayServer.WindowResizeEdge.TopRight,
            NativeWindowResizeController.ResolveResizeEdge(new Vector2(442, 8), size, 5, 10),
            "top-right resize edge");
        AssertEqual(
            DisplayServer.WindowResizeEdge.BottomLeft,
            NativeWindowResizeController.ResolveResizeEdge(new Vector2(8, 592), size, 5, 10),
            "bottom-left resize edge");
        AssertEqual(
            DisplayServer.WindowResizeEdge.BottomRight,
            NativeWindowResizeController.ResolveResizeEdge(new Vector2(442, 592), size, 5, 10),
            "bottom-right resize edge");
        AssertEqual(
            DisplayServer.WindowResizeEdge.Top,
            NativeWindowResizeController.ResolveResizeEdge(new Vector2(225, 2), size, 5, 10),
            "top resize edge");
        AssertEqual(
            DisplayServer.WindowResizeEdge.Right,
            NativeWindowResizeController.ResolveResizeEdge(new Vector2(448, 300), size, 5, 10),
            "right resize edge");
        AssertEqual(
            DisplayServer.WindowResizeEdge.Bottom,
            NativeWindowResizeController.ResolveResizeEdge(new Vector2(225, 598), size, 5, 10),
            "bottom resize edge");
        AssertEqual(
            DisplayServer.WindowResizeEdge.Left,
            NativeWindowResizeController.ResolveResizeEdge(new Vector2(2, 300), size, 5, 10),
            "left resize edge");
        AssertEqual<DisplayServer.WindowResizeEdge?>(
            null,
            NativeWindowResizeController.ResolveResizeEdge(new Vector2(225, 300), size, 5, 10),
            "window interior");
    }

    private static void TestsRendererUrlFollowerRuntime()
    {
        // ROOT CAUSE:
        //
        // Chat already used the minimal follower runtime. Notice still booted the
        // full Stage runtime, so a second CEF WebView started orchestrator work
        // and competed with software OSR compositing of the main stage.
        //
        // We fixed this by keeping Settings and developer windows on the full
        // follower runtime, and by giving Notice the same minimal runtime as Chat.
        const string baseUrl = "http://127.0.0.1:5173/";

        AssertEqual(
            "http://127.0.0.1:5173/?synced-leader=false#/settings",
            RendererUrl.ForFollowerRoute(baseUrl, "/settings"),
            "settings full follower URL");
        AssertEqual(
            "http://127.0.0.1:5173/?stage-runtime=minimal&synced-leader=false#/chat",
            RendererUrl.ForMinimalFollowerRoute(baseUrl, "/chat"),
            "chat minimal follower URL");
        AssertEqual(
            "http://127.0.0.1:5173/?stage-runtime=minimal&synced-leader=false#/spotlight",
            RendererUrl.ForMinimalFollowerRoute(baseUrl, "/spotlight"),
            "spotlight minimal follower URL");
        AssertEqual(
            "http://127.0.0.1:5173/?stage-runtime=minimal&synced-leader=false#/notice?id=one",
            RendererUrl.ForMinimalFollowerRoute(baseUrl, "/notice?id=one"),
            "notice minimal follower URL");
    }

    private static void TestsCefInspectorTargetSelection()
    {
        // ROOT CAUSE:
        //
        // The CEF debugging server returns an empty response at its root URL.
        // Opening that URL produced a blank system-browser page instead of DevTools.
        //
        // We fixed this by selecting the main page's frontend URL from /json/list.
        const string targetsJson = """
            [
              {
                "type": "page",
                "url": "http://127.0.0.1:5173/?synced-leader=false#/settings",
                "devtoolsFrontendUrl": "https://devtools.example/inspector.html?ws=follower"
              },
              {
                "type": "worker",
                "url": "http://127.0.0.1:5173/?synced-leader=true#/",
                "devtoolsFrontendUrl": "https://devtools.example/inspector.html?ws=worker"
              },
              {
                "type": "page",
                "url": "http://127.0.0.1:5173/?synced-leader=true#/",
                "devtoolsFrontendUrl": "https://devtools.example/inspector.html?ws=leader"
              }
            ]
            """;

        var inspectorUri = CefInspectorTarget.SelectMainInspectorUri(targetsJson);

        AssertEqual(
            "https://devtools.example/inspector.html?ws=leader",
            inspectorUri.AbsoluteUri,
            "main CEF inspector URL");
    }

    private static void TestsCefInspectorRequiresLeader()
    {
        const string targetsJson = """
            [
              {
                "type": "page",
                "url": "http://127.0.0.1:5173/?synced-leader=false#/settings",
                "devtoolsFrontendUrl": "https://devtools.example/inspector.html?ws=follower"
              }
            ]
            """;

        try
        {
            CefInspectorTarget.SelectMainInspectorUri(targetsJson);
        }
        catch (InvalidDataException)
        {
            return;
        }

        throw new InvalidOperationException("Expected inspector selection to reject a follower-only target list.");
    }

    private static void TestsDahliaNetworkAllowlist()
    {
        // Mirrors the allow/block cases in Electron's dahlia-network.test.ts:
        // the desktop app connects only to Dahlia's server, to GitHub for
        // its own updates, and to itself.
        string[] allowed =
        [
            "https://dahlia.aleytia.moe/api/v1/openai/chat/completions",
            "wss://dahlia.aleytia.moe/ws",
            "https://api.github.com/repos/AleytiaFairlight/Dahlia-avatar/releases?per_page=100",
            "https://github.com/AleytiaFairlight/Dahlia-avatar/releases/download/v0.12.0-beta.5.2/latest-x64.yml",
            "https://release-assets.githubusercontent.com/github-production-release-asset/1/2",
            "http://localhost:6121/ws",
            "ws://127.0.0.1:6121/ws",
            "http://[::1]:5173/",
            "airi-model://assets/model/1/model.json",
            "file:///C:/Users/me/AppData/model.vrm",
            "data:image/png;base64,AAAA",
        ];
        foreach (var url in allowed)
        {
            AssertEqual(true, DahliaNetworkService.IsAllowedUrl(url), $"allowed Dahlia network URL {url}");
        }

        string[] blocked =
        [
            "https://cdn.jsdelivr.net/fontsource/fonts/dm-sans@latest/latin-400-normal.woff2",
            "https://api.open-meteo.com/v1/forecast?latitude=1&longitude=2",
            "https://api.openai.com/v1/chat/completions",
            "https://analytics.airi.build/capture",
            "https://dahlia.aleytia.moe.example.com/",
            "wss://example.com/ws",
            "http://192.168.10.4:6121/ws",
        ];
        foreach (var url in blocked)
        {
            AssertEqual(false, DahliaNetworkService.IsAllowedUrl(url), $"blocked Dahlia network URL {url}");
        }

        AssertEqual(
            true,
            DahliaNetworkService.IsAllowedUrl(
                "https://avatar-test.example.com/x",
                ["avatar-test.example.com"]),
            "extra allowed host (DAHLIA_EXTRA_ALLOWED_HOST)");

        try
        {
            DahliaNetworkService.EnsureAllowed("https://api.open-meteo.com/v1/forecast");
        }
        catch (InvalidOperationException error)
        {
            AssertEqual(
                true,
                error.Message.Contains("api.open-meteo.com", StringComparison.Ordinal),
                "blocked host fetch refusal");
            return;
        }

        throw new InvalidOperationException("Expected EnsureAllowed to refuse a blocked URL.");
    }

    private static void TestsDahliaErrorReportQueue()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"dahlia-errors-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            using var reports = new DahliaErrorReports(dir, "tests", "0.0.0-test");
            reports.Queue("main-uncaught", "Error: boom");
            File.AppendAllText(
                Path.Combine(dir, DahliaErrorReports.PendingFileName),
                "not json\n");

            var first = reports.Take();
            AssertEqual("0.0.0-test", first.AppVersion, "taken error reports app version");
            AssertEqual(1, first.Reports.Count, "malformed pending lines are skipped");
            AssertEqual("main-uncaught", first.Reports[0].Kind, "taken error report kind");
            AssertEqual("main", first.Reports[0].Source, "taken error report source");
            AssertEqual("tests", first.Reports[0].Platform, "taken error report platform");

            AssertEqual(0, reports.Take().Reports.Count, "pending reports are cleared on take");

            AssertEqual(
                "#/chat",
                DahliaErrorReports.RouteOf("app://index.html#/chat?code=secret"),
                "error report page route");
            AssertEqual<string?>(
                null,
                DahliaErrorReports.RouteOf("app://index.html"),
                "error report page without route");
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    private static void TestsDahliaAppVersion()
    {
        // ROOT CAUSE:
        //
        // Prerelease numbers compare as text in a naive string sort, so beta.5.27 would read older
        // than beta.5.9. The desktop host avoids this through the semver package.
        //
        // We fixed this by ordering every numeric version part as a number, like semver does.
        AssertEqual(true, DahliaAppVersion.Compare("0.12.2-beta.9", "0.12.2-beta.27") < 0, "beta lanes compare as numbers");
        AssertEqual(true, DahliaAppVersion.Compare("0.12.2-beta.14", "0.12.2-beta.9") > 0, "later beta is newer");
        AssertEqual(true, DahliaAppVersion.Compare("0.12.2", "0.12.2-beta.14") > 0, "release beats its beta lane");
        AssertEqual(true, DahliaAppVersion.Compare("0.12.3-beta.0", "0.12.2-beta.14") > 0, "patch beats the beta lane below it");
        AssertEqual(0, DahliaAppVersion.Compare("0.12.2-beta.9", "0.12.2-beta.9"), "same version compares equal");
        AssertEqual(false, DahliaAppVersion.TryParse("not a version", out _, out _, out _, out _), "invalid version does not parse");
        AssertEqual(false, DahliaAppVersion.TryParse(null, out _, out _, out _, out _), "missing version does not parse");

        AssertEqual(
            "v0.12.2-beta.27",
            DahliaAppVersion.TryPickNewestTag(["v0.12.2-beta.9", "v0.12.2-beta.27", "not a version", "v0.12.1"]),
            "newest tag skips what does not parse");
    }

    private static void TestsDahliaUpdateFeed()
    {
        const string tag = "v0.12.2-beta.9";
        const string github = "https://github.com/AleytiaFairlight/Dahlia-avatar/releases/download/v0.12.2-beta.9";
        const string server = "https://dahlia.aleytia.moe/api/v1/dahlia/releases/download/v0.12.2-beta.9";

        var copied = new List<DahliaServerRelease>
        {
            new(tag, false, true, [new("kirie-latest-x64.json", "/api/v1/dahlia/releases/download/v0.12.2-beta.9/kirie-latest-x64.json")]),
        };
        AssertEqual(server, DahliaUpdateFeed.FeedUrlForRelease(copied, tag, "kirie-latest-x64.json", github), "server copy feeds the update");

        var absolute = new List<DahliaServerRelease>
        {
            new(tag, false, true, [new("kirie-latest-x64.json", "https://dahlia.aleytia.moe/api/v1/dahlia/releases/download/v0.12.2-beta.9/kirie-latest-x64.json")]),
        };
        AssertEqual(server, DahliaUpdateFeed.FeedUrlForRelease(absolute, tag, "kirie-latest-x64.json", github), "absolute server asset feeds the update");

        var elsewhere = new List<DahliaServerRelease>
        {
            new(tag, false, true, [new("kirie-latest-x64.json", "https://example.com/kirie-latest-x64.json")]),
        };
        AssertEqual(github, DahliaUpdateFeed.FeedUrlForRelease(elsewhere, tag, "kirie-latest-x64.json", github), "off-server asset falls back to GitHub");

        AssertEqual(github, DahliaUpdateFeed.FeedUrlForRelease([], tag, "kirie-latest-x64.json", github), "missing release falls back to GitHub");
        AssertEqual(github, DahliaUpdateFeed.FeedUrlForRelease(copied, "v0.12.2-beta.8", "kirie-latest-x64.json", github), "missing tag falls back to GitHub");
        AssertEqual(github, DahliaUpdateFeed.FeedUrlForRelease(copied, tag, "latest-x64.yml", github), "missing update file falls back to GitHub");

        var releases = new List<DahliaServerRelease>
        {
            new("v0.12.2-beta.9", false, true, []),
            new("v0.12.2-beta.27", false, true, []),
            new("v9.9.9", true, false, []),
            new(null, false, false, []),
        };
        AssertEqual("v0.12.2-beta.27", DahliaUpdateFeed.SelectNewestTag(releases), "newest finished release wins, drafts never ship");
        AssertEqual(null, DahliaUpdateFeed.SelectNewestTag([]), "no releases select no tag");

        using var stray = JsonDocument.Parse("\"not a list\"");
        AssertEqual(0, DahliaUpdateFeed.ParseReleases(stray.RootElement).Count, "a stray payload reads as no releases");

        using var payload = JsonDocument.Parse("""
            [{"tag_name":"v0.12.2-beta.9","draft":false,"prerelease":true,
              "assets":[{"name":"kirie-latest-x64.json","browser_download_url":"/api/v1/dahlia/releases/download/v0.12.2-beta.9/kirie-latest-x64.json"}]}]
            """);
        var parsed = DahliaUpdateFeed.ParseReleases(payload.RootElement);
        AssertEqual(1, parsed.Count, "release list parses");
        AssertEqual(tag, parsed[0].TagName, "release tag");
        AssertEqual("/api/v1/dahlia/releases/download/v0.12.2-beta.9/kirie-latest-x64.json", parsed[0].Assets[0].BrowserDownloadUrl, "release asset url");
    }

    private static void TestsDahliaUpdateCleanup()
    {
        AssertEqual("0.12.2-beta.9", DahliaUpdateCleanup.ReleaseFileVersion("Dahlia-Kirie-0.12.2-beta.9-windows-x64.zip"), "kirie release file version");
        AssertEqual("0.12.1-beta.3", DahliaUpdateCleanup.ReleaseFileVersion("Dahlia-Kirie-0.12.1-beta.3-windows-x64 (1).zip"), "numbered browser copy version");
        AssertEqual("0.11.3", DahliaUpdateCleanup.ReleaseFileVersion("Dahlia-Kirie-0.11.3-windows-x64.zip"), "release without a lane parses");

        AssertEqual<string?>(null, DahliaUpdateCleanup.ReleaseFileVersion("Dahlia-notes.pdf"), "other files have no version");
        AssertEqual<string?>(null, DahliaUpdateCleanup.ReleaseFileVersion("Dahlia-Kirie-0.12.2-beta.9-windows-x64.zip.blockmap"), "partial downloads have no version");
        AssertEqual<string?>(null, DahliaUpdateCleanup.ReleaseFileVersion("Kirie-0.12.2-windows-x64.zip"), "files without the Dahlia prefix stay");
        // The Electron host's installers stay: this cleanup only removes Kirie release files.
        AssertEqual<string?>(null, DahliaUpdateCleanup.ReleaseFileVersion("Dahlia-0.12.2-beta.9-windows-x64-setup.exe"), "desktop installers stay");

        var names = new[]
        {
            "Dahlia-Kirie-0.12.2-beta.9-windows-x64.zip",
            "Dahlia-Kirie-0.12.2-beta.27-windows-x64.zip",
            "Dahlia-Kirie-0.12.2-beta.28-windows-x64.zip",
            "Dahlia-Kirie-0.11.9-windows-x64 (2).zip",
            "vacation.jpg",
        };

        // beta.9 is older than beta.27: prerelease numbers compare as numbers, not as text.
        var old = DahliaUpdateCleanup.OldReleaseFiles(names, "0.12.2-beta.27");
        AssertEqual("Dahlia-Kirie-0.12.2-beta.9-windows-x64.zip,Dahlia-Kirie-0.11.9-windows-x64 (2).zip", string.Join(',', old), "release files older than the running host");
        AssertEqual(0, DahliaUpdateCleanup.OldReleaseFiles(names, "not a version").Count, "invalid running version removes nothing");

        // Removes the old release files, and goes on when the folder cannot be read or one
        // file cannot be removed.
        var removed = DahliaUpdateCleanup.CleanOldKirieDownloadsAsync(
            Path.Combine(Path.GetTempPath(), $"dahlia-cleanup-{Guid.NewGuid():N}"),
            "0.12.2-beta.27",
            list: _ => ["Dahlia-Kirie-0.12.2-beta.25-windows-x64.zip", "Dahlia-Kirie-0.12.2-beta.26-windows-x64.zip", "Dahlia-Kirie-0.12.2-beta.27-windows-x64.zip", "notes.txt"],
            remove: path => path.Contains("beta.25", StringComparison.Ordinal)
                ? Task.FromException(new IOException("open in another program"))
                : Task.CompletedTask).GetAwaiter().GetResult();
        AssertEqual("Dahlia-Kirie-0.12.2-beta.26-windows-x64.zip", string.Join(',', removed), "only removable old release files go");

        var unreadable = DahliaUpdateCleanup.CleanOldKirieDownloadsAsync(
            "nowhere",
            "0.12.2-beta.27",
            list: _ => throw new DirectoryNotFoundException("ENOENT"),
            remove: _ => Task.CompletedTask).GetAwaiter().GetResult();
        AssertEqual(0, unreadable.Count, "unreadable folder removes nothing");
    }

    private static void TestsDahliaAutoUpdate()
    {
        // Downloads a release as soon as one is found.
        var source = new FakeDahliaUpdateSource();
        using (var updates = StartAutoUpdate(source))
        {
            source.Emit(DahliaUpdateStatus.Available, new DahliaUpdateInfo("0.12.2-beta.27"));
            AssertEqual(1, source.DownloadCalls, "available release downloads at once");
        }

        // Downloads a release that was found before it started.
        var early = new FakeDahliaUpdateSource(DahliaUpdateStatus.Available);
        early.Emit(DahliaUpdateStatus.Available, new DahliaUpdateInfo("0.12.2-beta.27"));
        using (StartAutoUpdate(early))
        {
            AssertEqual(1, early.DownloadCalls, "release found before start downloads");
        }

        // Checks every hour, but not while an update waits to be installed.
        var scheduled = new FakeDahliaUpdateSource();
        using (var updates = StartAutoUpdate(scheduled))
        {
            updates.Process(DahliaAutoUpdate.CheckIntervalSeconds);
            AssertEqual(1, scheduled.CheckCalls, "hourly check");
            scheduled.Emit(DahliaUpdateStatus.Downloaded, new DahliaUpdateInfo("0.12.2-beta.27"));
            updates.Process(DahliaAutoUpdate.CheckIntervalSeconds);
            AssertEqual(1, scheduled.CheckCalls, "no check while an update waits to install");
        }

        // Installs a downloaded update only once the computer is idle, and only once.
        var idle = 0.0;
        var staged = new FakeDahliaUpdateSource();
        using (var updates = new DahliaAutoUpdate(staged, () => idle))
        {
            updates.Start();
            idle = DahliaAutoUpdate.IdleSecondsThreshold - 1;
            updates.Process(DahliaAutoUpdate.InstallPollSeconds);
            staged.Emit(DahliaUpdateStatus.Downloaded, new DahliaUpdateInfo("0.12.2-beta.27"));
            updates.Process(DahliaAutoUpdate.InstallPollSeconds);
            AssertEqual(0, staged.InstallCalls, "no install while the computer is busy");

            idle = DahliaAutoUpdate.IdleSecondsThreshold;
            updates.Process(DahliaAutoUpdate.InstallPollSeconds);
            updates.Process(DahliaAutoUpdate.InstallPollSeconds);
            AssertEqual(1, staged.InstallCalls, "idle install runs once");
        }

        // A downloaded update installs when the host quits.
        var quitting = new FakeDahliaUpdateSource();
        using (var updates = StartAutoUpdate(quitting))
        {
            AssertEqual(false, updates.InstallOnQuitIfReady(), "quit without a download installs nothing");
            quitting.Emit(DahliaUpdateStatus.Downloaded, new DahliaUpdateInfo("0.12.2-beta.27"));
            AssertEqual(true, updates.InstallOnQuitIfReady(), "quit with a download installs");
            AssertEqual(false, updates.InstallOnQuitIfReady(), "quit install runs once");
            AssertEqual(1, quitting.InstallCalls, "quit install calls the source once");
        }

        // Old downloads go on start.
        var cleaned = new List<string>();
        var cleaner = new FakeDahliaUpdateSource();
        using (var cleaning = new DahliaAutoUpdate(cleaner, () => 0.0, new DahliaAutoUpdateOptions
        {
            CleanOldDownloads = () =>
            {
                cleaned.Add("Dahlia-Kirie-0.12.1-windows-x64.zip");
                return Task.FromResult<IReadOnlyList<string>>(cleaned);
            },
        }))
        {
            cleaning.Start();
            AssertEqual("Dahlia-Kirie-0.12.1-windows-x64.zip", string.Join(',', cleaned), "old downloads go on start");
        }

        // Does nothing when updates are off, and stops when asked.
        var off = new FakeDahliaUpdateSource(DahliaUpdateStatus.Disabled);
        using (var updates = new DahliaAutoUpdate(off, () => double.MaxValue))
        {
            updates.Start();
            updates.Process(DahliaAutoUpdate.CheckIntervalSeconds);
            AssertEqual(0, off.CheckCalls, "disabled host never checks");

            var live = new FakeDahliaUpdateSource();
            var running = new DahliaAutoUpdate(live, () => 0.0);
            running.Start();
            running.Dispose();
            live.Emit(DahliaUpdateStatus.Available, new DahliaUpdateInfo("0.12.2-beta.27"));
            AssertEqual(0, live.DownloadCalls, "stopped host ignores releases");
            running.Dispose();
        }
    }

    private static void TestsDahliaUpdateManifest()
    {
        using var payload = JsonDocument.Parse("""
            {"version":"0.12.2-beta.27","releaseDate":"2026-11-21T00:00:00.000Z",
             "files":[{"name":"Dahlia-Kirie-0.12.2-beta.27-windows-x64.zip",
                       "url":"https://example.test/Dahlia-Kirie-0.12.2-beta.27-windows-x64.zip",
                       "sha512":"abc"}]}
            """);
        var manifest = DahliaUpdateManifest.Parse(payload.RootElement, "https://example.test/manifest");
        AssertEqual("0.12.2-beta.27", manifest.Version, "manifest version");
        AssertEqual(1, manifest.Files.Count, "manifest files");

        using var shapeless = JsonDocument.Parse("""{"files":[]}""");
        try
        {
            DahliaUpdateManifest.Parse(shapeless.RootElement, "https://example.test/manifest");
            throw new InvalidOperationException("Expected manifest parsing to reject a shapeless payload.");
        }
        catch (InvalidDataException)
        {
        }

        using var versionless = JsonDocument.Parse("""{"version":"not a version","files":[{"name":"a.zip","url":"https://example.test/a.zip"}]}""");
        try
        {
            DahliaUpdateManifest.Parse(versionless.RootElement, "https://example.test/manifest");
            throw new InvalidOperationException("Expected manifest parsing to reject a bad version.");
        }
        catch (InvalidDataException)
        {
        }
    }

    private static DahliaAutoUpdate StartAutoUpdate(FakeDahliaUpdateSource source)
    {
        var updates = new DahliaAutoUpdate(source, () => 0.0);
        updates.Start();
        return updates;
    }

    private static void TestsDahliaPowerShellArguments()
    {
        var args = DahliaPowerShellRunner.BuildArguments("Get-ChildItem \"C:\\Users\"\nWrite-Output 'done'");
        AssertEqual("-NoProfile", args[0], "powershell argument profile");
        AssertEqual("-NonInteractive", args[1], "powershell argument interactive");
        AssertEqual("-ExecutionPolicy", args[2], "powershell argument policy");
        AssertEqual("Bypass", args[3], "powershell argument bypass");
        AssertEqual("-EncodedCommand", args[4], "powershell argument encoded");
        var script = System.Text.Encoding.Unicode.GetString(Convert.FromBase64String(args[5]));
        AssertEqual(true, script.Contains("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8"), "powershell utf8 prefix");
        AssertEqual(true, script.EndsWith("Get-ChildItem \"C:\\Users\"\nWrite-Output 'done'"), "powershell command as written");
        AssertEqual(16_000, DahliaPowerShellRunner.MaxOutput, "powershell output cap");
    }

    private static void TestsDahliaPowerShellRefusals()
    {
        var empty = DahliaPowerShellRunner
            .RunAsync(new DahliaPowerShellRequestPayload("  ", null))
            .GetAwaiter().GetResult();
        AssertEqual(false, empty.Ok, "empty powershell refused");
        AssertEqual("No command was given.", empty.Output, "empty powershell message");

        // The runner never spawns for an empty command, on any platform.
        if (!OperatingSystem.IsWindows())
        {
            var elsewhere = DahliaPowerShellRunner
                .RunAsync(new DahliaPowerShellRequestPayload("Get-Date", null))
                .GetAwaiter().GetResult();
            AssertEqual(false, elsewhere.Ok, "powershell off Windows refused");
            AssertEqual("PowerShell runs only in the Windows app.", elsewhere.Output, "powershell off Windows message");
        }
    }

    private static void TestsDahliaFilesServer()
    {
        // Added once, with the host executable and the script.
        var added = DahliaFilesService.WithDahliaFilesServer("{}", "C:\\app\\dahlia.exe", "C:\\app\\dahlia-files-mcp.mjs", addIfMissing: true);
        AssertEqual(true, added is not null, "file server added");
        using var addedJson = JsonDocument.Parse(added!);
        var entry = addedJson.RootElement.GetProperty("mcpServers").GetProperty("dahlia-files");
        AssertEqual("C:\\app\\dahlia.exe", entry.GetProperty("command").GetString(), "file server command");
        AssertEqual("C:\\app\\dahlia-files-mcp.mjs", entry.GetProperty("args")[0].GetString(), "file server script");
        AssertEqual("1", entry.GetProperty("env").GetProperty("ELECTRON_RUN_AS_NODE").GetString(), "file server node mode");

        // Up to date: nothing changes.
        AssertEqual<string?>(null, DahliaFilesService.WithDahliaFilesServer(added!, "C:\\app\\dahlia.exe", "C:\\app\\dahlia-files-mcp.mjs", addIfMissing: false), "file server steady");

        // Moved app: paths refresh, the user's folders and choices stay.
        var moved = DahliaFilesService.WithDahliaFilesServer(
            """{"mcpServers":{"dahlia-files":{"command":"C:\\old\\dahlia.exe","args":["C:\\old\\dahlia-files-mcp.mjs","D:\\work"],"env":{"ELECTRON_RUN_AS_NODE":"1"},"enabled":false}}}""",
            "C:\\app\\dahlia.exe",
            "C:\\app\\dahlia-files-mcp.mjs",
            addIfMissing: false);
        AssertEqual(true, moved is not null, "file server refreshed");
        using var movedJson = JsonDocument.Parse(moved!);
        var refreshed = movedJson.RootElement.GetProperty("mcpServers").GetProperty("dahlia-files");
        AssertEqual("C:\\app\\dahlia.exe", refreshed.GetProperty("command").GetString(), "file server command refreshed");
        AssertEqual("D:\\work", refreshed.GetProperty("args")[1].GetString(), "file server folders kept");
        AssertEqual(false, refreshed.GetProperty("enabled").GetBoolean(), "file server choice kept");

        // A removed entry stays removed; a broken file stays as it is.
        AssertEqual<string?>(null, DahliaFilesService.WithDahliaFilesServer("{}", "C:\\app\\dahlia.exe", "C:\\app\\dahlia-files-mcp.mjs", addIfMissing: false), "removed file server stays removed");
        AssertEqual<string?>(null, DahliaFilesService.WithDahliaFilesServer("{oops", "C:\\app\\dahlia.exe", "C:\\app\\dahlia-files-mcp.mjs", addIfMissing: true), "broken config untouched");
        AssertEqual<string?>(null, DahliaFilesService.WithDahliaFilesServer("[]", "C:\\app\\dahlia.exe", "C:\\app\\dahlia-files-mcp.mjs", addIfMissing: true), "shapeless config untouched");
    }

    private static void TestsDahliaPcState()
    {
        var deps = new DahliaPcStateDeps
        {
            Foreground = () => Task.FromResult(new DahliaForegroundAnswer(true, "code", "main.ts - dahlia", null, null, null)),
            IdleSeconds = () => 7,
            OwnFocused = () => true,
            CpuTimes = () => [(100L, 1000L)],
            FreeMemory = () => 2000,
            TotalMemory = () => 8000,
        };
        var reporter = new DahliaPcStateReporter(deps);
        // The processor share is measured between two answers.
        AssertEqual<int?>(null, reporter.GetStateAsync().GetAwaiter().GetResult().Cpu, "first pc sample has no cpu share");
        deps.CpuTimes = () => [(150L, 1100L)];
        var state = reporter.GetStateAsync().GetAwaiter().GetResult();
        AssertEqual("code", state.App, "pc state app");
        AssertEqual("main.ts - dahlia", state.Title, "pc state title");
        AssertEqual(true, state.Own, "pc state own window");
        AssertEqual(7L, state.IdleSeconds, "pc state idle");
        AssertEqual(50, state.Cpu, "pc state cpu share");
        AssertEqual(75, state.Memory, "pc state memory share");
        AssertEqual<int?>(null, state.Gpu, "pc state gpu unknown");

        // Without the window helper the rest is still worth telling: the real
        // counters back the defaults on this machine.
        var bare = new DahliaPcStateReporter(new DahliaPcStateDeps()).GetStateAsync().GetAwaiter().GetResult();
        AssertEqual(string.Empty, bare.App, "bare pc state app");
        AssertEqual(false, bare.Own, "bare pc state own window");
        AssertEqual<int?>(null, bare.Cpu, "bare pc state cpu");
        AssertEqual(true, bare.Memory is >= 0 and <= 100, "bare pc state memory range");
    }

    private static void TestsDahliaStorageGuard()
    {
        // The shipped zero-length record header validates as one record.
        var empty = DahliaStorageGuard.ValidateWalBuffer(DahliaStorageGuard.ZeroRecordHeader);
        AssertEqual(true, empty.Valid, "zero header valid");
        AssertEqual(1, empty.TotalRecords, "zero header records");

        // A valid log stays valid; with garbage after it, truncation repairs it.
        // (Ten bad bytes: a zero-header patch still leaves a torn tail, so the
        // log is cut back to its last valid record instead.)
        var valid = DahliaStorageGuard.ZeroRecordHeader;
        AssertEqual(true, DahliaStorageGuard.ValidateWalBuffer(valid).Valid, "short log valid");
        var damaged = valid.Concat(new byte[] { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF }).ToArray();
        var checked_ = DahliaStorageGuard.ValidateWalBuffer(damaged);
        AssertEqual(false, checked_.Valid, "garbage tail invalid");
        var repair = DahliaStorageGuard.AttemptWalRepair(damaged, checked_.LastValidOffset);
        AssertEqual(true, repair.Repaired, "tail truncated");
        AssertEqual("truncation", repair.Strategy, "truncation strategy");
        AssertEqual(true, DahliaStorageGuard.ValidateWalBuffer(repair.RepairedBuffer!).Valid, "repaired log valid");

        // Masking round-trips.
        AssertEqual(0x12345678u, DahliaStorageGuard.UnmaskCrc32C(DahliaStorageGuard.MaskCrc32C(0x12345678u)), "crc mask round trip");
    }

    private static void TestsDahliaWindowRecovery()
    {
        var history = new List<long>();
        for (var i = 0; i < DahliaWindowRecovery.MaxReloads; i++)
        {
            AssertEqual(true, DahliaWindowRecovery.ShouldReloadPage("crashed", history, 1000 + i, quitting: false), "crashed page reloads");
        }

        AssertEqual(false, DahliaWindowRecovery.ShouldReloadPage("crashed", history, 2000, quitting: false), "broken page stops looping");
        AssertEqual(true, DahliaWindowRecovery.ShouldReloadPage("crashed", history, 1000 + DahliaWindowRecovery.ReloadWindowMs + DahliaWindowRecovery.MaxReloads, quitting: false), "old reloads age out");

        AssertEqual(false, DahliaWindowRecovery.ShouldReloadPage("clean-exit", new List<long>(), 1000, quitting: false), "clean exit stays closed");
        AssertEqual(false, DahliaWindowRecovery.ShouldReloadPage("killed", new List<long>(), 1000, quitting: true), "quitting stays closed");

        var tracker = new DahliaWindowRecoveryTracker();
        AssertEqual(true, tracker.NoteStopped("main", "oom", 1000, quitting: false), "tracker reloads once");
    }

    private static void TestsDahliaLogging()
    {
        // The host log must never throw, and writes through to the file.
        // InitForTests avoids the engine (Godot APIs segfault outside it).
        var directory = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dahlia-log-test-" + Guid.NewGuid().ToString("N"));
        var printed = new List<string>();
        DahliaLog.InitForTests(directory, printed.Add);
        DahliaLog.Write("test milestone");
        AssertEqual(true, DahliaLog.Path.Length > 0, "log path is set");
        AssertEqual(true, printed.Count >= 2, "banner and milestone print");
        var text = File.ReadAllText(DahliaLog.Path);
        AssertEqual(true, text.Contains("test milestone"), "milestone reaches the file");
        Directory.Delete(directory, recursive: true);
    }

    private static void TestsDahliaWindowTitleRank()
    {
        // Dahlia's window helper ranks titles the same way on both hosts: exact, starts-with, contains.
        AssertEqual(2, DahliaWindowHelper.TitleRank("DarkWar", "darkwar"), "game window exact title");
        AssertEqual(1, DahliaWindowHelper.TitleRank("DarkWar Survival", "darkwar"), "game window title start");
        AssertEqual(0, DahliaWindowHelper.TitleRank("Play DarkWar Now", "darkwar"), "game window title part");
        AssertEqual(-1, DahliaWindowHelper.TitleRank("Notepad", "darkwar"), "other window title");
        AssertEqual(-1, DahliaWindowHelper.TitleRank("DarkWar", "  "), "blank title part");

        var names = new List<string> { "Play DarkWar Now", "DarkWar", "Notepad" };
        AssertEqual(
            "DarkWar",
            DahliaWindowHelper.PickWindowName(names, "darkwar", new HashSet<string>()),
            "best window title wins");
        AssertEqual(
            "Play DarkWar Now",
            DahliaWindowHelper.PickWindowName(names, "darkwar", new HashSet<string> { "DarkWar" }),
            "Dahlia's own windows never match");
        AssertEqual(
            null,
            DahliaWindowHelper.PickWindowName(names, "calc", new HashSet<string>()),
            "no window matches");
    }

    private static void TestsDahliaGameLauncherNames()
    {
        // Dahlia's game finder names games the same way on both hosts.
        AssertEqual("darkwarsurvival", DahliaGameLauncherService.Compact("Dark War: Survival"), "game name compact");
        AssertEqual(true, DahliaGameLauncherService.NameMatches("DarkWarSurvival.lnk", "Dark War: Survival"), "shortcut names the game");
        AssertEqual(true, DahliaGameLauncherService.NameMatches("DarkWar", "Dark War: Survival"), "folder starts the game name");
        AssertEqual(false, DahliaGameLauncherService.NameMatches("chrome.exe", "Dark War: Survival"), "browser is not the game");
        AssertEqual(false, DahliaGameLauncherService.NameMatches("DarkWar.exe", string.Empty), "blank game name never matches");
    }

    private static void TestsDahliaRecordingFileName()
    {
        // A file name from a window title: no characters Windows forbids, not too long.
        var at = new DateTime(2026, 11, 21, 12, 34, 56, DateTimeKind.Local);
        AssertEqual(
            "Dahlia - Dark War - 2026-11-21 12-34-56.png",
            DahliaScreenCaptureService.RecordingFileName("Dark War", "png", at),
            "picture file name");
        AssertEqual(
            "Dahlia - A B C - 2026-11-21 12-34-56.mp4",
            DahliaScreenCaptureService.RecordingFileName("A/B:C", "mp4", at),
            "forbidden characters become spaces");
        AssertEqual(
            "Dahlia - Screen - 2026-11-21 12-34-56.webm",
            DahliaScreenCaptureService.RecordingFileName("  ", "avi", at),
            "blank title falls back to Screen");
        AssertEqual(
            $"Dahlia - {new string('W', 60)} - 2026-11-21 12-34-56.mp4",
            DahliaScreenCaptureService.RecordingFileName(new string('W', 100), "mp4", at),
            "long title truncates to 60 characters");

        // The scene model files that Dahlia's server hands out, checked by SHA-256.
        AssertEqual(3, DahliaSceneModelService.SceneFiles.Count, "scene model files");
        AssertEqual(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            DahliaSceneModelService.Sha256Hex("abc"u8.ToArray()),
            "scene file checksum");
    }

    private static void TestsDahliaScreenRecordingOps()
    {
        // The host records with ScreenRecorderLib where Electron used MediaRecorder in
        // the renderer; the routing below runs the Windows ops on any platform through
        // fakes (the platform check and the encoder are injected).
        var videos = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"dahlia-recordings-{Guid.NewGuid():N}")).FullName;
        try
        {
            var factory = new FakeDahliaScreenRecorderFactory();
            using var service = new DahliaScreenCaptureService(
                () => throw new InvalidOperationException("The tests replace the window helper."),
                new NoopDahliaRegistration(),
                factory,
                (request, _) =>
                {
                    if (request["op"]?.GetValue<string>() == "find"
                        && request["title"]?.GetValue<string>() == "DarkWar")
                        return Task.FromResult(new JsonObject { ["ok"] = true, ["hwnd"] = 1234L, ["title"] = "DarkWar Survival" });
                    return Task.FromResult(DahliaWindowHelper.ErrorNode("Unknown request."));
                },
                () => true,
                videos);

            // Unknown ops still fall through.
            var unknown = Answer(new JsonObject { ["op"] = "rewind" });
            AssertEqual<bool?>(false, unknown["ok"]?.GetValue<bool>(), "recording unknown op fails");
            AssertEqual("Unknown request.", unknown["error"]?.GetValue<string>(), "recording unknown op message");

            // Stopping with nothing running is an error, not a crash.
            var idle = Answer(new JsonObject { ["op"] = "record-done" });
            AssertEqual("No recording is running.", idle["error"]?.GetValue<string>(), "record-done without a recording");

            // A window recording starts through the helper's handle and stops to Videos\Dahlia.
            var started = Answer(new JsonObject { ["op"] = "record-source", ["window"] = "DarkWar" });
            AssertEqual<bool?>(true, started["ok"]?.GetValue<bool>(), "record-source window starts");
            AssertEqual("DarkWar Survival", started["title"]?.GetValue<string>(), "record-source window title");
            AssertEqual("window:1234", string.Join(',', factory.Started), "record-source window handle");

            // One recording at a time, like Electron's renderer-side recording flag.
            var again = Answer(new JsonObject { ["op"] = "record-source", ["screen"] = 1L });
            AssertEqual("A recording is already running.", again["error"]?.GetValue<string>(), "second record-source refused");

            var stopped = Answer(new JsonObject { ["op"] = "record-done" });
            AssertEqual<bool?>(true, stopped["ok"]?.GetValue<bool>(), "record-done stops");
            var path = stopped["path"]?.GetValue<string>() ?? string.Empty;
            AssertEqual(true, path.StartsWith(videos, StringComparison.Ordinal), "recording lands in the videos folder");
            AssertEqual(true, path.EndsWith(".mp4", StringComparison.Ordinal), "recording is an mp4");
            AssertEqual(true, File.Exists(path), "recording file exists");
            AssertEqual(4L, stopped["bytes"]?.GetValue<long>(), "recording bytes");
            AssertEqual("DarkWar Survival", stopped["title"]?.GetValue<string>(), "recording title");

            var stoppedAgain = Answer(new JsonObject { ["op"] = "record-done" });
            AssertEqual("No recording is running.", stoppedAgain["error"]?.GetValue<string>(), "record-done ends one recording");

            // A numbered screen out of range names how many screens this PC has.
            var missing = Answer(new JsonObject { ["op"] = "record-source", ["screen"] = 9L });
            AssertEqual("This PC has 2 screens.", missing["error"]?.GetValue<string>(), "record-source missing screen");

            // The main screen records without a number; a handle records without a title.
            var screen = Answer(new JsonObject { ["op"] = "record-source" });
            AssertEqual<bool?>(true, screen["ok"]?.GetValue<bool>(), "record-source main screen starts");
            AssertEqual("main", factory.Started[^1], "record-source main display");
            var screenDone = Answer(new JsonObject { ["op"] = "record-done" });
            AssertEqual("the main screen", screenDone["title"]?.GetValue<string>(), "main screen recording title");

            var handle = Answer(new JsonObject { ["op"] = "record-source", ["hwnd"] = 4321L });
            AssertEqual<bool?>(true, handle["ok"]?.GetValue<bool>(), "record-source handle starts");
            AssertEqual("window:4321", factory.Started[^1], "record-source handle");
            var handleDone = Answer(new JsonObject { ["op"] = "record-done" });
            AssertEqual("window 4321", handleDone["title"]?.GetValue<string>(), "handle recording title");

            var second = Answer(new JsonObject { ["op"] = "record-source", ["screen"] = 2L });
            AssertEqual<bool?>(true, second["ok"]?.GetValue<bool>(), "record-source second screen starts");
            AssertEqual("display:1", factory.Started[^1], "record-source second display");
            var secondDone = Answer(new JsonObject { ["op"] = "record-done" });
            AssertEqual("screen 2", secondDone["title"]?.GetValue<string>(), "second screen recording title");

            // An unknown window title reports what Electron reported.
            var gone = Answer(new JsonObject { ["op"] = "record-source", ["window"] = "Missing" });
            AssertEqual("No open window has \"Missing\" in its title.", gone["error"]?.GetValue<string>(), "record-source missing window");

            // An encoder failure surfaces on stop, and frees the next recording.
            factory.Failure = "The encoder failed.";
            var failed = Answer(new JsonObject { ["op"] = "record-source", ["screen"] = 1L });
            AssertEqual<bool?>(true, failed["ok"]?.GetValue<bool>(), "record-source starts before the failure");
            var failure = Answer(new JsonObject { ["op"] = "record-done" });
            AssertEqual("The encoder failed.", failure["error"]?.GetValue<string>(), "record-done reports the failure");
            factory.Failure = null;
            var after = Answer(new JsonObject { ["op"] = "record-source", ["screen"] = 1L });
            AssertEqual<bool?>(true, after["ok"]?.GetValue<bool>(), "recording after a failure starts");
            Answer(new JsonObject { ["op"] = "record-done" });

            // save-recording still guards empty and huge blobs.
            var empty = Answer(new JsonObject { ["op"] = "save-recording", ["data"] = string.Empty, ["extension"] = "mp4", ["title"] = "x" });
            AssertEqual("The recording is empty or too big.", empty["error"]?.GetValue<string>(), "save-recording empty refused");

            JsonObject Answer(JsonObject request)
            {
                return service.AnswerAsync(request, CancellationToken.None).GetAwaiter().GetResult();
            }
        }
        finally
        {
            Directory.Delete(videos, recursive: true);
        }
    }

    private static void TestsDahliaEventIds()
    {
        // The Godot host and the renderer must invoke the same Eventa ids.
        AssertEqual("eventa:invoke:dahlia:window:call", DahliaEvents.EventIds["window"], "window channel");
        AssertEqual("eventa:invoke:dahlia:screen:call", DahliaEvents.EventIds["screen"], "screen channel");
        AssertEqual("eventa:invoke:dahlia:scene:call", DahliaEvents.EventIds["scene"], "scene channel");
        AssertEqual("eventa:invoke:dahlia:game-launcher:call", DahliaEvents.EventIds["game-launcher"], "game launcher channel");
        AssertEqual("eventa:invoke:dahlia:powershell:run", DahliaEvents.EventIds["powershell"], "powershell channel");
        AssertEqual("eventa:invoke:dahlia:host-name:get", DahliaEvents.EventIds["host-name"], "host name channel");
        AssertEqual("eventa:invoke:dahlia:pc-state:get", DahliaEvents.EventIds["pc-state"], "pc state channel");
        AssertEqual("eventa:invoke:dahlia:ghost-cursor:show", DahliaEvents.EventIds["ghost-cursor"], "ghost cursor channel");
        AssertEqual("eventa:invoke:dahlia:network-scan:run", DahliaEvents.EventIds["network-scan"], "network scan channel");
        AssertEqual("eventa:invoke:dahlia:ssh:run", DahliaEvents.EventIds["ssh"], "ssh channel");
        AssertEqual("eventa:invoke:dahlia:ssh-settings:get", DahliaEvents.EventIds["ssh-settings"], "ssh settings channel");
        AssertEqual("eventa:invoke:dahlia:workflow:call", DahliaEvents.EventIds["workflow"], "workflow channel");
    }

    private static void TestsDahliaGhostCursor()
    {
        // Dahlia's ghost cursor points where she says, with her words as text, never as markup.
        AssertEqual(null, DahliaGhostCursor.Validate(10, 20), "finite point validates");
        AssertEqual("Send the point as {x, y}.", DahliaGhostCursor.Validate(double.NaN, 20), "endless point refused");

        AssertEqual("hello world", DahliaGhostCursor.NormalizeLabel("  hello   world  "), "label collapses spaces");
        AssertEqual(80, DahliaGhostCursor.NormalizeLabel(new string('x', 200)).Length, "label capped at 80");
        AssertEqual(string.Empty, DahliaGhostCursor.NormalizeLabel(null), "missing label empty");

        AssertEqual(6000, DahliaGhostCursor.ClampMs(null), "cursor default duration");
        AssertEqual(1500, DahliaGhostCursor.ClampMs(100), "cursor minimum duration");
        AssertEqual(15000, DahliaGhostCursor.ClampMs(100_000), "cursor maximum duration");
        AssertEqual(7000, DahliaGhostCursor.ClampMs(7000), "cursor duration as asked");

        var page = DahliaGhostCursor.GhostCursorPage("<img src=x onerror=alert(1)> \"click\"");
        AssertEqual(true, page.Contains("&lt;img src=x onerror=alert(1)&gt; &quot;click&quot;"), "cursor words escaped");
        AssertEqual(false, page.Contains("<img"), "cursor words never markup");
        AssertEqual(false, DahliaGhostCursor.GhostCursorPage(string.Empty).Contains("class=\"label\""), "cursor without words has no label");
    }

    private static void TestsDahliaNetworkScan()
    {
        // Light scans stay local; heavy scans belong to the Dahlia Agent via MCP.
        AssertEqual(false, DahliaNetworkScan.IsHeavyScan("ports", "full"), "light scan stays local");
        AssertEqual(false, DahliaNetworkScan.IsHeavyScan(null, null), "default scan stays local");
        AssertEqual(true, DahliaNetworkScan.IsHeavyScan("vuln", "full"), "vuln scan is heavy");
        AssertEqual(true, DahliaNetworkScan.IsHeavyScan("ports", "syn"), "raw-packet probe is heavy");

        var discovery = DahliaNetworkScan.ScanArguments(new DahliaNetworkScanRequestPayload("192.168.10.0/24", "discovery", null, null, null, null));
        AssertEqual(null, discovery.Error, "discovery target validates");
        AssertEqual("-sn", discovery.Args![0], "discovery flag");
        AssertEqual("192.168.10.0/24", discovery.Args[^1], "scan target last");

        var heavy = DahliaNetworkScan.ScanArguments(new DahliaNetworkScanRequestPayload("10.0.0.1", "vuln", null, null, null, null));
        AssertEqual(null, heavy.Args, "heavy scan has no nmap flags");
        AssertEqual(true, heavy.Error!.Contains("Dahlia Agent"), "heavy scan routed to the agent");

        var bad = DahliaNetworkScan.ScanArguments(new DahliaNetworkScanRequestPayload("-sT evil", "ports", null, null, null, null));
        AssertEqual(true, bad.Error!.Contains("host name"), "flag target refused");

        var unknown = DahliaNetworkScan.ScanArguments(new DahliaNetworkScanRequestPayload("nas.local", "bogus", null, null, null, null));
        AssertEqual(true, unknown.Error!.Contains("Unknown scan type"), "unknown scan type refused");

        AssertEqual("22,80,81,82", string.Join(',', DahliaNetworkScan.ParsePortList("22,80-82")), "port list expands ranges");
        AssertEqual(20, DahliaNetworkScan.ParsePortList(null).Count, "default top ports");
        try
        {
            DahliaNetworkScan.ParsePortList("1-5000");
            throw new InvalidOperationException("Expected an over-wide port range to throw.");
        }
        catch (InvalidOperationException error) when (error.Message.Contains("Bad port range"))
        {
        }
        try
        {
            DahliaNetworkScan.ParsePortList("1-1000,2000");
            throw new InvalidOperationException("Expected too many ports to throw.");
        }
        catch (InvalidOperationException error) when (error.Message.Contains("at most"))
        {
        }

        var (range, rangeError) = DahliaNetworkScan.ExpandTargetHosts("192.168.10.1-3");
        AssertEqual(null, rangeError, "dash range expands");
        AssertEqual("192.168.10.1,192.168.10.2,192.168.10.3", string.Join(',', range!), "dash range hosts");
        var (cidr, cidrError) = DahliaNetworkScan.ExpandTargetHosts("192.168.10.0/30");
        AssertEqual(null, cidrError, "small block expands");
        AssertEqual("192.168.10.1,192.168.10.2", string.Join(',', cidr!), "small block skips network and broadcast");
        AssertEqual(true, DahliaNetworkScan.ExpandTargetHosts("10.0.0.0/16").Error!.Contains("narrow it"), "wide block refused");

        AssertEqual("ssh", DahliaNetworkScan.BuiltInServiceNames[22], "service name");

        // The built-in prober reports over TCP connect, with the service names above.
        var probed = DahliaNetworkScan.BuiltInScanAsync(
            ["example.test"],
            [22, 80],
            "ports",
            5_000,
            (host, port) => Task.FromResult((port == 22, (string?)null))).GetAwaiter().GetResult();
        AssertEqual(true, probed.Contains("22/tcp  open  ssh"), "open port reported with its service");
        AssertEqual(false, probed.Contains("80/tcp"), "closed port not reported");

        var found = DahliaNetworkScan.BuiltInScanAsync(
            ["example.test"],
            [22],
            "discovery",
            5_000,
            (host, port) => Task.FromResult((false, (string?)null))).GetAwaiter().GetResult();
        AssertEqual("(no output)", found, "quiet discovery reports nothing");

        AssertEqual(true, DahliaNetworkScan.Clip(new string('x', 30_000)).EndsWith("[cut: the report was longer]"), "long reports cut with a marker");
    }

    private static void TestsDahliaSsh()
    {
        // The server reads as a host, a user@host or a user@host:port.
        var (plain, plainError) = DahliaSsh.ParseSshTarget("nas.local", "root", null);
        AssertEqual(null, plainError, "plain target parses");
        AssertEqual("root", plain!.User, "plain target user");
        AssertEqual(22, plain.Port, "plain target default port");

        var (at, atError) = DahliaSsh.ParseSshTarget("pi@192.168.10.20:2222", null, null);
        AssertEqual(null, atError, "user at host parses");
        AssertEqual("pi", at!.User, "at target user");
        AssertEqual(2222, at.Port, "at target port");

        AssertEqual(true, DahliaSsh.ParseSshTarget("nas; rm -rf /", "root", null).Error!.Contains("host name"), "flag host refused");
        AssertEqual(true, DahliaSsh.ParseSshTarget("nas", null, null).Error!.Contains("user name"), "missing user refused");
        AssertEqual("root@nas.local:22", DahliaSsh.SshTargetName(plain), "login name");

        // A host key's fingerprint reads as OpenSSH shows it.
        var fingerprint = DahliaSsh.SshFingerprint("key"u8.ToArray());
        AssertEqual(true, fingerprint.StartsWith("SHA256:", StringComparison.Ordinal), "fingerprint mark");
        AssertEqual(50, fingerprint.Length, "fingerprint length");

        var dir = Path.Combine(Path.GetTempPath(), $"dahlia-ssh-{Guid.NewGuid():N}");
        try
        {
            var store = new DahliaSshStore
            {
                SshDirectory = Path.Combine(dir, ".ssh"),
                DataDirectory = Path.Combine(dir, "data"),
                CanEncrypt = () => true,
                Encrypt = text => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"enc:{text}")),
                Decrypt = data => System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(data))[4..],
            };
            const string password = "correct horse battery staple";

            DahliaSsh.SaveSshPasswordAsync(plain, password, store).GetAwaiter().GetResult();
            var settings = DahliaSsh.SettingsAsync(
                new DahliaSshSettingsRequestPayload("list", null, null, null, null, null), store).GetAwaiter().GetResult();
            AssertEqual("root@nas.local:22", string.Join(',', settings.Passwords), "saved login listed");
            AssertEqual(null, settings.PublicKey, "no key made by listing");
            AssertEqual(false, File.ReadAllText(Path.Combine(store.DataDirectory, "dahlia-ssh-passwords.json")).Contains(password), "password encrypted at rest");

            var saved = DahliaSsh.RunAsync(
                new DahliaSshRequestPayload("save-password", "nas.local", "root", null, null, password, null, null), store).GetAwaiter().GetResult();
            AssertEqual(true, saved.Ok, "chat-told password saved");
            AssertEqual(false, saved.Output.Contains(password), "saved password never repeated");

            var empty = DahliaSsh.RunAsync(
                new DahliaSshRequestPayload("run", "nas.local", "root", null, null, null, null, null), store).GetAwaiter().GetResult();
            AssertEqual(true, empty.Output.Contains("Give the command"), "missing command refused");

            // Nothing here reaches a server: unknown ops stop before any login.
            var unknown = DahliaSsh.RunAsync(
                new DahliaSshRequestPayload("bogus", "nas.local", "root", null, null, null, null, null), store).GetAwaiter().GetResult();
            AssertEqual("Unknown request.", unknown.Output, "unknown ssh op refused");

            var forgotten = DahliaSsh.SettingsAsync(
                new DahliaSshSettingsRequestPayload("delete-password", null, null, null, null, "root@nas.local:22"), store).GetAwaiter().GetResult();
            AssertEqual(0, forgotten.Passwords.Count, "deleted login gone");

            try
            {
                DahliaSsh.SettingsAsync(
                    new DahliaSshSettingsRequestPayload("save-password", "pi", "pi", null, null, null), store).GetAwaiter().GetResult();
                throw new InvalidOperationException("Expected a missing settings password to throw.");
            }
            catch (InvalidOperationException error) when (error.Message.Contains("Type the password"))
            {
            }
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    private static void TestsDahliaWorkflow()
    {
        // The browser steps match pages, labels and messages the same way on both hosts.
        AssertEqual(true, DahliaWorkflowBrowser.IsSignInPage("https://login.microsoftonline.com/common/oauth2"), "microsoft login page");
        AssertEqual(true, DahliaWorkflowBrowser.IsSignInPage("https://na.myconnectwise.net/v4_6_release/login/login.html"), "connectwise login page");
        AssertEqual(false, DahliaWorkflowBrowser.IsSignInPage("https://outlook.office.com/mail/"), "outlook mail list is no sign-in");
        AssertEqual(false, DahliaWorkflowBrowser.IsSignInPage("not a url"), "shapeless address is no sign-in");

        AssertEqual(true, DahliaWorkflowBrowser.IsTicketLink("https://na.myconnectwise.net/ticket?id=1"), "https ticket link");
        AssertEqual(true, DahliaWorkflowBrowser.IsTicketLink("http://127.0.0.1:5000/ticket"), "ticket page on this PC");
        AssertEqual(false, DahliaWorkflowBrowser.IsTicketLink("http://example.com/ticket"), "plain http is no ticket");
        AssertEqual(false, DahliaWorkflowBrowser.IsTicketLink("javascript:alert(1)"), "script is no ticket");

        AssertEqual(true, DahliaWorkflowBrowser.ExactName("New Note").IsMatch("  new note "), "whole button name matches");
        AssertEqual(false, DahliaWorkflowBrowser.ExactName("Save").IsMatch("Save & Close"), "button name must be whole");
        AssertEqual(true, DahliaWorkflowBrowser.ExactName("+ Note").IsMatch("+ Note"), "symbol name matches");
        AssertEqual(true, DahliaWorkflowBrowser.FolderName("Tickets").IsMatch("Tickets 3 unread"), "folder with unread count matches");
        AssertEqual(false, DahliaWorkflowBrowser.FolderName("Tickets").IsMatch("TicketsArchive"), "folder must not glue");

        AssertEqual("conv:AQQk=", DahliaWorkflowBrowser.MailKey("AQQk=", "Unread Ticket #1", "Unread"), "message keyed by conversation");
        AssertEqual(
            DahliaWorkflowBrowser.MailKey(null, "Ticket #1", "Unread"),
            DahliaWorkflowBrowser.MailKey(null, "Unread Ticket #1", "Unread"),
            "message key ignores the unread mark");
        AssertEqual(
            "div[role=option][data-convid=\"a\\\"b\"]",
            DahliaWorkflowBrowser.MailSelector("div[role=option]", "a\"b", 0),
            "message found by escaped conversation");
        AssertEqual(
            ":nth-match(div[role=option], 3)",
            DahliaWorkflowBrowser.MailSelector("div[role=option]", null, 2),
            "message found by place");

        AssertEqual("one two …", DahliaWorkflowBrowser.Cut("one two three four", 9), "text cut at a word");
        AssertEqual("a\n\nb", DahliaWorkflowBrowser.Cut("a\n\n\n\n b", 100), "blank runs collapse");
        var fitted = DahliaWorkflowBrowser.FitAnswer(
            new System.Text.Json.Nodes.JsonObject
            {
                ["subject"] = "x",
                ["body"] = new string('w', 20_000),
            },
            "body");
        AssertEqual(true, fitted.ToJsonString().Length <= DahliaWorkflowBrowser.MaxAnswerChars, "answer fits her server");
        AssertEqual("x", fitted["subject"]?.GetValue<string>(), "short fields kept while fitting");

        AssertEqual(true, DahliaWorkflowBrowser.SignInError("Outlook").Message.StartsWith($"{DahliaWorkflowBrowser.SignInMark}Outlook"), "sign-in error marked");

        AssertEqual("SIGNIN:", DahliaWorkflowBrowser.SignInMark, "sign-in mark");

        // Steps need Chrome, which the Kirie host drives none of; anything else is unknown.
        AssertEqual(false, DahliaWorkflowBrowser.IsKnownOp("unknown-step"), "unknown workflow step refused");
        AssertEqual(true, DahliaWorkflowBrowser.IsKnownOp("ticket_read"), "ticket read is a workflow step");
        var ticket = DahliaWorkflowBrowser.BrowserUnavailable("ticket_read");
        AssertEqual(false, ticket["ok"]?.GetValue<bool>(), "browser step without a browser refused");
        AssertEqual(true, ticket["error"]?.GetValue<string>()?.Contains("Chrome") ?? false, "browser step names Chrome");
    }

    private static void AssertEqual<T>(T expected, T actual, string label)
    {
        if (EqualityComparer<T>.Default.Equals(expected, actual))
        {
            return;
        }

        throw new InvalidOperationException(
            $"Expected {label} to be '{expected}', got '{actual}'.");
    }

}
