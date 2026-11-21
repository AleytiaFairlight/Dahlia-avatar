using Eventa;

/// <summary>
/// Dahlia's typed Eventa channels between the Kirie renderer and the Godot host.
/// Each channel carries one JSON value and answers one JSON value, the same shape
/// Electron's "dahlia:host-name", "dahlia:powershell" and "dahlia:pc-state" IPC
/// channels use. The flat dahlia:window/screen/scene/game-launcher host-call
/// channels live in <see cref="DahliaEvents"/> instead.
/// </summary>
internal static class DahliaDesktopEvents
{
    public static readonly InvokeEventDefinition<string, EmptyPayload> GetHostName =
        new("eventa:invoke:dahlia:host-name:get");

    public static readonly InvokeEventDefinition<DahliaPowerShellResultPayload, DahliaPowerShellRequestPayload> RunPowerShell =
        new("eventa:invoke:dahlia:powershell:run");

    public static readonly InvokeEventDefinition<DahliaPcStatePayload, EmptyPayload> GetPcState =
        new("eventa:invoke:dahlia:pc-state:get");
}
