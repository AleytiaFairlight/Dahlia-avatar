using System.Net.Http;
using Godot;
using NetHttpClient = System.Net.Http.HttpClient;
using NetHttpHandler = System.Net.Http.HttpMessageHandler;
using NetHttpRequest = System.Net.Http.HttpRequestMessage;
using NetHttpResponse = System.Net.Http.HttpResponseMessage;

/// <summary>
/// Dahlia network allowlist: the desktop app connects only to Dahlia's
/// server, to GitHub for its own updates, and to itself.
///
/// Port of Electron's <c>src/main/dahlia-network.ts</c> (<c>isAllowedUrl</c>,
/// <c>guardFetch</c>, <c>restrictNetworkToDahlia</c>).
/// Kirie exposes no CEF request filter (KirieClient only surfaces media
/// permission requests), so the allowlist guards what the host itself
/// loads: WebView navigation entries (<c>initial_url</c>/<c>load_url</c>,
/// checked by Main before creating the main WebView) and host-side HTTP
/// (via <see cref="DahliaNetworkGuardHandler"/>).
/// In-WebView subresource loads come from the bundled renderer, which talks
/// only to Dahlia's server; external HTTP(S) leaves the app through
/// Platform <c>openExternalUrl</c> into the system browser.
/// </summary>
internal static class DahliaNetworkService
{
    /// <summary>Hosts outside this machine that the app may reach.</summary>
    public static readonly string[] AllowedHosts =
    [
        "dahlia.aleytia.moe",
        // Updates: the Dahlia-avatar releases API and release files, and the hosts GitHub sends downloads to.
        "api.github.com",
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    ];

    private static readonly HashSet<string> NetworkSchemes = new(StringComparer.OrdinalIgnoreCase)
    {
        Uri.UriSchemeHttp,
        Uri.UriSchemeHttps,
        "ws",
        "wss",
    };

    /// <summary>
    /// Whether the app may open this URL. Only web and WebSocket addresses
    /// are judged: the app's own schemes (files, models, bundled assets)
    /// never leave the machine.
    /// </summary>
    public static bool IsAllowedUrl(string? url, IReadOnlyList<string>? allowedHosts = null)
    {
        allowedHosts ??= AllowedHosts;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed))
        {
            return true;
        }

        if (!NetworkSchemes.Contains(parsed.Scheme))
        {
            return true;
        }

        var host = parsed.Host.Trim('[', ']').ToLowerInvariant();
        if (host == "localhost"
            || host.EndsWith(".localhost", StringComparison.Ordinal)
            || host == "::1"
            || IsLoopbackV4(host))
        {
            return true;
        }

        return allowedHosts.Contains(host, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Whether the app may navigate a WebView to this URL. A test build can
    /// add its server with <c>DAHLIA_EXTRA_ALLOWED_HOST</c>.
    /// </summary>
    public static bool IsAllowedNavigation(string? url)
    {
        return IsAllowedUrl(url, ResolveAllowedHosts());
    }

    /// <summary>
    /// Throws unless <see cref="IsAllowedUrl"/> accepts the URL, mirroring
    /// the rejected fetch in Electron's <c>guardFetch</c>.
    /// </summary>
    public static void EnsureAllowed(string? url, IReadOnlyList<string>? allowedHosts = null)
    {
        if (IsAllowedUrl(url, allowedHosts))
        {
            return;
        }

        var host = BlockedHost(url) ?? url ?? string.Empty;
        throw new InvalidOperationException(
            $"Dahlia blocked {host}: the app connects only to Dahlia's server.");
    }

    /// <summary>The host (with port when explicit) of a blocked URL.</summary>
    public static string? BlockedHost(string? url)
    {
        if (IsAllowedUrl(url))
        {
            return null;
        }

        if (Uri.TryCreate(url, UriKind.Absolute, out var parsed))
        {
            return parsed.Authority;
        }

        return url;
    }

    /// <summary>Warns about a blocked request, truncating the URL like Electron does.</summary>
    public static void LogBlocked(string? url)
    {
        var preview = url is not null && url.Length > 200 ? url[..200] : url;
        GD.PushWarning($"Dahlia blocked a request to {preview}");
    }

    /// <summary>Creates host-side HTTP that refuses non-allowlisted URLs without sending them.</summary>
    public static NetHttpClient CreateGuardedClient(TimeSpan? timeout = null)
    {
        var client = new NetHttpClient(new DahliaNetworkGuardHandler(), disposeHandler: true);
        if (timeout.HasValue)
        {
            client.Timeout = timeout.Value;
        }

        return client;
    }

    internal static IReadOnlyList<string> ResolveAllowedHosts()
    {
        var extra = OS.GetEnvironment("DAHLIA_EXTRA_ALLOWED_HOST").Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(extra) ? AllowedHosts : [.. AllowedHosts, extra];
    }

    private static bool IsLoopbackV4(string host)
    {
        var parts = host.Split('.');
        return parts.Length == 4
            && parts[0] == "127"
            && parts.Skip(1).All(part =>
                part.Length is >= 1 and <= 3 && part.All(char.IsAsciiDigit));
    }
}

/// <summary>
/// Host-side HTTP handler that refuses every URL
/// <see cref="DahliaNetworkService.IsAllowedUrl"/> rejects.
/// </summary>
internal sealed class DahliaNetworkGuardHandler : DelegatingHandler
{
    private readonly IReadOnlyList<string> _allowedHosts;

    public DahliaNetworkGuardHandler(
        IReadOnlyList<string>? allowedHosts = null,
        NetHttpHandler? innerHandler = null)
        : base(innerHandler ?? new HttpClientHandler())
    {
        _allowedHosts = allowedHosts ?? DahliaNetworkService.ResolveAllowedHosts();
    }

    protected override Task<NetHttpResponse> SendAsync(
        NetHttpRequest request,
        CancellationToken cancellationToken)
    {
        var url = request.RequestUri?.ToString() ?? string.Empty;
        if (!DahliaNetworkService.IsAllowedUrl(url, _allowedHosts))
        {
            DahliaNetworkService.LogBlocked(url);
        }

        DahliaNetworkService.EnsureAllowed(url, _allowedHosts);
        return base.SendAsync(request, cancellationToken);
    }
}
