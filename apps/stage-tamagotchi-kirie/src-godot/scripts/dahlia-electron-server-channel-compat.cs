using System.Text.Json.Nodes;
using Eventa;

/// <summary>
/// Compatibility answers for the renderer's <c>electron:server-channel:*</c>
/// channels (shared <c>eventa/index.ts</c>, used by the Connection settings
/// page and its QR pairing card). The Kirie host runs no channel server:
/// AIRI's module bus on ws://localhost:6121 is deferred (see the Kirie
/// README), and Dahlia's own device link uses her server (SERVER_URL
/// fetches), not this channel. get-config/apply-config answer an in-memory
/// stub so the settings page works instead of dropping its invokes as
/// unregistered Eventa messages; the QR pairing payload fails closed (there
/// is no server to pair with), which the card renders as its designed error
/// state.
/// </summary>
internal sealed record ElectronServerChannelConfigPayload(
    JsonNode? TlsConfig,
    string Hostname,
    string AuthToken);

internal sealed record ElectronServerChannelApplyPayload(
    JsonNode? TlsConfig,
    string? Hostname,
    string? AuthToken);

internal sealed record ElectronServerChannelQrPayload(
    string Type,
    int Version,
    JsonArray Urls,
    string AuthToken);

internal static class DahliaElectronServerChannelCompat
{
    public static readonly InvokeEventDefinition<ElectronServerChannelConfigPayload, EmptyPayload> GetConfig =
        new("eventa:invoke:electron:server-channel:get-config");

    public static readonly InvokeEventDefinition<ElectronServerChannelConfigPayload, ElectronServerChannelApplyPayload> ApplyConfig =
        new("eventa:invoke:electron:server-channel:apply-config");

    public static readonly InvokeEventDefinition<ElectronServerChannelQrPayload, EmptyPayload> GetQrPayload =
        new("eventa:invoke:electron:server-channel:get-qr-payload");

    /// <summary>
    /// Answers the settings page from an in-memory stub (there is no channel
    /// server behind it) and fails QR pairing closed. The renderer always
    /// sends every config field on apply, so the stub echoes what arrived.
    /// </summary>
    public static IDisposable Attach(IEventContext context)
    {
        var current = new ElectronServerChannelConfigPayload(null, "127.0.0.1", string.Empty);
        var guard = new object();
        var get = context.RegisterInvokeHandler(
            GetConfig,
            (EmptyPayload _, CancellationToken _) =>
            {
                lock (guard)
                {
                    return Task.FromResult(current);
                }
            });
        var apply = context.RegisterInvokeHandler(
            ApplyConfig,
            (ElectronServerChannelApplyPayload request, CancellationToken _) =>
            {
                lock (guard)
                {
                    current = new ElectronServerChannelConfigPayload(
                        request.TlsConfig,
                        request.Hostname ?? current.Hostname,
                        request.AuthToken ?? current.AuthToken);
                    return Task.FromResult(current);
                }
            });
        var qr = context.RegisterInvokeHandler(
            GetQrPayload,
            (EmptyPayload _, CancellationToken _) => Task.FromException<ElectronServerChannelQrPayload>(
                new InvalidOperationException(
                    "The server channel isn't available in the Kirie host, so there is nothing to pair with.")));
        return new DisposableGroup(get, apply, qr);
    }
}
