using System.Text.Json.Nodes;
using Eventa;

/// <summary>
/// Compatibility answers for the renderer's <c>electron:mcp:*</c> channels
/// (shared <c>eventa/index.ts</c>, used by the MCP tools store and by
/// Dahlia's remote tools). The Kirie host has no MCP manager yet: the plugin
/// host, MCP configuration and stdio process lifecycle are deferred (see the
/// Kirie README). Answering an empty tool list keeps those callers working
/// the same as "no MCP servers configured" instead of dropping their invokes
/// as unregistered Eventa messages.
/// </summary>
internal sealed record ElectronMcpToolDescriptorPayload(
    string ServerName,
    string Name,
    string ToolName,
    string? Description,
    JsonObject InputSchema);

internal sealed record ElectronMcpCallToolRequestPayload(
    string Name,
    JsonObject? Arguments);

internal sealed record ElectronMcpCallToolResultPayload(
    JsonArray? Content,
    JsonObject? StructuredContent,
    JsonNode? ToolResult,
    bool? IsError);

internal static class DahliaElectronMcpCompat
{
    public static readonly InvokeEventDefinition<List<ElectronMcpToolDescriptorPayload>, EmptyPayload> ListTools =
        new("eventa:invoke:electron:mcp:list-tools");

    public static readonly InvokeEventDefinition<ElectronMcpCallToolResultPayload, ElectronMcpCallToolRequestPayload> CallTool =
        new("eventa:invoke:electron:mcp:call-tool");

    /// <summary>
    /// No MCP servers run under the Kirie host, so there are no tools; calls
    /// fail closed with the same shape a failed Electron tool call has.
    /// </summary>
    public static IDisposable Attach(IEventContext context)
    {
        var list = context.RegisterInvokeHandler(
            ListTools,
            (EmptyPayload _, CancellationToken _) =>
                Task.FromResult(new List<ElectronMcpToolDescriptorPayload>()));
        var call = context.RegisterInvokeHandler(
            CallTool,
            (ElectronMcpCallToolRequestPayload _, CancellationToken _) =>
                Task.FromResult(new ElectronMcpCallToolResultPayload(null, null, null, true)));
        return new DisposableGroup(list, call);
    }
}
