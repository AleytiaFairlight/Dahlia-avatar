using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Eventa;
using GdKirie.EventaAdapter;

internal sealed record DahliaHostCallRequest(string Json);
internal sealed record DahliaHostCallAnswer(string Json);

/// <summary>
/// Dahlia's system tools on this PC: PowerShell for her other devices, the
/// host name, and the PC state for PC awareness. Unlike the vision and game
/// channels above (flat JSON through one call shape), these are typed invokes;
/// like those, the renderer reaches them through renderer/dahlia-host.ts.
/// </summary>
internal sealed record DahliaPowerShellRequestPayload(string Command, double? TimeoutSeconds);

internal sealed record DahliaPowerShellResultPayload(
    bool Ok,
    int? ExitCode,
    string Output,
    bool TimedOut);

internal sealed record DahliaPcStatePayload(
    string App,
    string Title,
    bool Own,
    long IdleSeconds,
    int? Cpu,
    int Memory,
    int? Gpu,
    int? Volume,
    bool? Muted);

/// <summary>
/// Dahlia's ghost cursor: a translucent pointer with a few of her words where
/// she points on the screen (the renderer's dahlia-backseat.ts), for a few
/// seconds. Port of Electron's <c>src/main/dahlia-ghost-cursor.ts</c> channel
/// <c>dahlia:ghost-cursor</c>.
/// </summary>
internal sealed record DahliaGhostCursorRequestPayload(double X, double Y, string? Label, double? Ms);

internal sealed record DahliaGhostCursorResultPayload(bool Ok, string? Error);

/// <summary>
/// Dahlia's local network scans (the renderer's <c>network_scan</c> tool), on
/// <c>dahlia:network-scan</c>. Light scans (discovery/ports/service, full TCP
/// connect) stay local: nmap when installed, else a built-in TCP prober. Heavy
/// scans (vuln/intrusive/exploit, syn/syn-fin/syn-rst) belong to the Dahlia
/// Agent via MCP and are refused here. Port of Electron's
/// <c>src/main/dahlia-network-scan.ts</c>.
/// </summary>
internal sealed record DahliaNetworkScanRequestPayload(
    string Target,
    string? ScanType,
    string? Ports,
    string? ConnectType,
    bool? AllowIntrusive,
    double? TimeoutSeconds);

internal sealed record DahliaNetworkScanResultPayload(bool Ok, int? ExitCode, string Output, bool TimedOut);

/// <summary>
/// Dahlia's SSH from this PC (the renderer's <c>ssh</c> tools), on
/// <c>dahlia:ssh</c>: one login running one command (<c>run</c>), this PC's
/// public key (<c>key</c>), installing it on a server (<c>install_key</c>), or
/// saving a chat-told password (<c>save-password</c>). Port of Electron's
/// <c>src/main/dahlia-ssh.ts</c>; ssh2 is replaced by the system's
/// <c>ssh</c>/<c>ssh-keygen</c>/<c>ssh-keyscan</c> (OpenSSH), with
/// <c>sshpass</c> for password logins when it is installed.
/// </summary>
internal sealed record DahliaSshRequestPayload(
    string Op,
    string? Host,
    string? User,
    int? Port,
    string? Command,
    string? Password,
    double? TimeoutSeconds,
    string? Target);

internal sealed record DahliaSshResultPayload(bool Ok, int? ExitCode, string Output);

internal sealed record DahliaSshKnownHostPayload(string Host, string Fingerprint);

/// <summary>
/// Settings &gt; Dahlia &gt; SSH (the renderer's <c>dahlia-ssh-settings</c>
/// channel): this PC's key, saved logins, trusted host keys. A password goes
/// in, never out.
/// </summary>
internal sealed record DahliaSshSettingsRequestPayload(
    string Op,
    string? Host,
    string? User,
    int? Port,
    string? Password,
    string? Target);

internal sealed record DahliaSshSettingsPayload(
    string? PublicKey,
    string KeyFile,
    List<string> Passwords,
    List<DahliaSshKnownHostPayload> Hosts,
    bool CanSavePasswords);

/// <summary>
/// Dahlia's vision and game channels between the Kirie renderer and the Godot host.
/// Each channel carries one flat JSON request ({"op": ..., ...fields}) and answers one
/// flat JSON answer ({"ok": true, ...} or {"ok": false, "error": ...}), the same shape
/// Electron's "dahlia:window", "dahlia:screen", "dahlia:scene" and "dahlia:game-launcher"
/// IPC channels use. The renderer stringifies the request so binary-adjacent payloads
/// (base64 pictures, OCR JSON) travel without extra Eventa payload types.
/// </summary>
internal static class DahliaEvents
{
    public static readonly InvokeEventDefinition<DahliaHostCallAnswer, DahliaHostCallRequest> WindowCall =
        new("eventa:invoke:dahlia:window:call");

    public static readonly InvokeEventDefinition<DahliaHostCallAnswer, DahliaHostCallRequest> ScreenCall =
        new("eventa:invoke:dahlia:screen:call");

    public static readonly InvokeEventDefinition<DahliaHostCallAnswer, DahliaHostCallRequest> SceneCall =
        new("eventa:invoke:dahlia:scene:call");

    public static readonly InvokeEventDefinition<DahliaHostCallAnswer, DahliaHostCallRequest> GameLauncherCall =
        new("eventa:invoke:dahlia:game-launcher:call");

    public static readonly InvokeEventDefinition<DahliaPowerShellResultPayload, DahliaPowerShellRequestPayload> RunPowerShell =
        new("eventa:invoke:dahlia:powershell:run");

    public static readonly InvokeEventDefinition<string, EmptyPayload> GetHostName =
        new("eventa:invoke:dahlia:host-name:get");

    public static readonly InvokeEventDefinition<DahliaPcStatePayload, EmptyPayload> GetPcState =
        new("eventa:invoke:dahlia:pc-state:get");

    public static readonly InvokeEventDefinition<DahliaGhostCursorResultPayload, DahliaGhostCursorRequestPayload> ShowGhostCursor =
        new("eventa:invoke:dahlia:ghost-cursor:show");

    public static readonly InvokeEventDefinition<DahliaNetworkScanResultPayload, DahliaNetworkScanRequestPayload> RunNetworkScan =
        new("eventa:invoke:dahlia:network-scan:run");

    public static readonly InvokeEventDefinition<DahliaSshResultPayload, DahliaSshRequestPayload> RunSsh =
        new("eventa:invoke:dahlia:ssh:run");

    public static readonly InvokeEventDefinition<DahliaSshSettingsPayload, DahliaSshSettingsRequestPayload> SshSettings =
        new("eventa:invoke:dahlia:ssh-settings:get");

    public static readonly InvokeEventDefinition<DahliaHostCallAnswer, DahliaHostCallRequest> WorkflowCall =
        new("eventa:invoke:dahlia:workflow:call");

    /// <summary>
    /// The Eventa ids, mirrored by src-web/src/shared/eventa/dahlia.ts. The C# and
    /// TypeScript tests assert these stay in sync.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> EventIds = new Dictionary<string, string>
    {
        ["window"] = "eventa:invoke:dahlia:window:call",
        ["screen"] = "eventa:invoke:dahlia:screen:call",
        ["scene"] = "eventa:invoke:dahlia:scene:call",
        ["game-launcher"] = "eventa:invoke:dahlia:game-launcher:call",
        ["powershell"] = "eventa:invoke:dahlia:powershell:run",
        ["host-name"] = "eventa:invoke:dahlia:host-name:get",
        ["pc-state"] = "eventa:invoke:dahlia:pc-state:get",
        ["ghost-cursor"] = "eventa:invoke:dahlia:ghost-cursor:show",
        ["network-scan"] = "eventa:invoke:dahlia:network-scan:run",
        ["ssh"] = "eventa:invoke:dahlia:ssh:run",
        ["ssh-settings"] = "eventa:invoke:dahlia:ssh-settings:get",
        ["workflow"] = "eventa:invoke:dahlia:workflow:call",
    };
}

internal static class DahliaContracts
{
    public static KirieEventaJsonRegistry Register(KirieEventaJsonRegistry registry)
    {
        return registry
            .RegisterInvoke(
                DahliaEvents.WindowCall,
                DahliaJsonContext.Default.DahliaHostCallAnswer,
                DahliaJsonContext.Default.DahliaHostCallRequest)
            .RegisterInvoke(
                DahliaEvents.ScreenCall,
                DahliaJsonContext.Default.DahliaHostCallAnswer,
                DahliaJsonContext.Default.DahliaHostCallRequest)
            .RegisterInvoke(
                DahliaEvents.SceneCall,
                DahliaJsonContext.Default.DahliaHostCallAnswer,
                DahliaJsonContext.Default.DahliaHostCallRequest)
            .RegisterInvoke(
                DahliaEvents.GameLauncherCall,
                DahliaJsonContext.Default.DahliaHostCallAnswer,
                DahliaJsonContext.Default.DahliaHostCallRequest)
            .RegisterInvoke(
                DahliaEvents.RunPowerShell,
                DahliaJsonContext.Default.DahliaPowerShellResultPayload,
                DahliaJsonContext.Default.DahliaPowerShellRequestPayload)
            .RegisterInvoke(
                DahliaEvents.GetHostName,
                DahliaJsonContext.Default.String,
                DahliaJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                DahliaEvents.GetPcState,
                DahliaJsonContext.Default.DahliaPcStatePayload,
                DahliaJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                DahliaEvents.ShowGhostCursor,
                DahliaJsonContext.Default.DahliaGhostCursorResultPayload,
                DahliaJsonContext.Default.DahliaGhostCursorRequestPayload)
            .RegisterInvoke(
                DahliaEvents.RunNetworkScan,
                DahliaJsonContext.Default.DahliaNetworkScanResultPayload,
                DahliaJsonContext.Default.DahliaNetworkScanRequestPayload)
            .RegisterInvoke(
                DahliaEvents.RunSsh,
                DahliaJsonContext.Default.DahliaSshResultPayload,
                DahliaJsonContext.Default.DahliaSshRequestPayload)
            .RegisterInvoke(
                DahliaEvents.SshSettings,
                DahliaJsonContext.Default.DahliaSshSettingsPayload,
                DahliaJsonContext.Default.DahliaSshSettingsRequestPayload)
            .RegisterInvoke(
                DahliaEvents.WorkflowCall,
                DahliaJsonContext.Default.DahliaHostCallAnswer,
                DahliaJsonContext.Default.DahliaHostCallRequest)
            .RegisterInvoke(
                DahliaElectronMcpCompat.ListTools,
                DahliaJsonContext.Default.ListElectronMcpToolDescriptorPayload,
                DahliaJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                DahliaElectronMcpCompat.CallTool,
                DahliaJsonContext.Default.ElectronMcpCallToolResultPayload,
                DahliaJsonContext.Default.ElectronMcpCallToolRequestPayload);
    }

    /// <summary>
    /// Packs an answer node into a host-call answer. Binary blobs travel as base64
    /// strings inside the JSON.
    /// </summary>
    public static DahliaHostCallAnswer Answer(JsonNode value)
    {
        return new DahliaHostCallAnswer(value.ToJsonString());
    }

    public static DahliaHostCallAnswer OkError(string error)
    {
        var node = new JsonObject { ["ok"] = false, ["error"] = error };
        return new DahliaHostCallAnswer(node.ToJsonString());
    }

    public static string GetString(JsonObject request, string field)
    {
        return request[field]?.GetValue<string>() ?? string.Empty;
    }

    public static long GetLong(JsonObject request, string field)
    {
        return request[field]?.GetValue<long>() ?? 0;
    }

    public static bool GetBool(JsonObject request, string field)
    {
        return request[field]?.GetValue<bool>() ?? false;
    }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(DahliaHostCallRequest))]
[JsonSerializable(typeof(DahliaHostCallAnswer))]
[JsonSerializable(typeof(EmptyPayload))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(DahliaPowerShellRequestPayload))]
[JsonSerializable(typeof(DahliaPowerShellResultPayload))]
[JsonSerializable(typeof(DahliaPcStatePayload))]
[JsonSerializable(typeof(DahliaGhostCursorRequestPayload))]
[JsonSerializable(typeof(DahliaGhostCursorResultPayload))]
[JsonSerializable(typeof(DahliaNetworkScanRequestPayload))]
[JsonSerializable(typeof(DahliaNetworkScanResultPayload))]
[JsonSerializable(typeof(DahliaSshRequestPayload))]
[JsonSerializable(typeof(DahliaSshResultPayload))]
[JsonSerializable(typeof(DahliaSshKnownHostPayload))]
[JsonSerializable(typeof(DahliaSshSettingsRequestPayload))]
[JsonSerializable(typeof(DahliaSshSettingsPayload))]
[JsonSerializable(typeof(ElectronMcpToolDescriptorPayload))]
[JsonSerializable(typeof(List<ElectronMcpToolDescriptorPayload>))]
[JsonSerializable(typeof(ElectronMcpCallToolRequestPayload))]
[JsonSerializable(typeof(ElectronMcpCallToolResultPayload))]
internal sealed partial class DahliaJsonContext : JsonSerializerContext;
