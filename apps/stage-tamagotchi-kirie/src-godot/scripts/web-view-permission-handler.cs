using Godot;

internal sealed class WebViewPermissionHandler : IDisposable
{
    private readonly KirieClient _kirie;
    private readonly Uri _trustedOrigin;
    private readonly MicrophonePermissionService? _microphonePermissions;
    private bool _disposed;

    public WebViewPermissionHandler(
        KirieClient kirie,
        string rendererUrl,
        MicrophonePermissionService? microphonePermissions = null)
    {
        _kirie = kirie;
        _trustedOrigin = ParseOrigin(rendererUrl);
        _microphonePermissions = microphonePermissions;
        _kirie.PermissionRequested += OnPermissionRequested;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _kirie.PermissionRequested -= OnPermissionRequested;
    }

    private void OnPermissionRequested(string permissionType, string origin, long requestId)
    {
        if (StringComparer.Ordinal.Equals(permissionType, "microphone")
            && HasSameOrigin(origin)
            && _microphonePermissions is not null)
        {
            _microphonePermissions.Request(granted => Resolve(requestId, granted));
            return;
        }

        // Dahlia: the bundled renderer talks to this device (ws://localhost:6121
        // server-channel, Ollama, other loopback services). Chromium treats the
        // custom res:// origin as needing Private Network Access permission for
        // those, while Electron never prompted. Grant local-network to our own
        // origin for parity; anything else stays denied.
        if (StringComparer.Ordinal.Equals(permissionType, "local_network")
            && HasSameOrigin(origin))
        {
            Resolve(requestId, granted: true);
            return;
        }

        Resolve(requestId, granted: false);
    }

    private readonly HashSet<long> _settledRequests = [];

    private void Resolve(long requestId, bool granted)
    {
        // A request CEF already settled (a superseded duplicate from a
        // mount burst, a timed-out prompt) is gone: resolving it again is a
        // no-op, not an error. Only a first-attempt failure is worth noise,
        // and even that resolves nothing, so it stays a warning.
        var duplicate = !_settledRequests.Add(requestId);
        var resolved = granted
            ? _kirie.GrantPermission(requestId)
            : _kirie.DenyPermission(requestId);
        if (!resolved && !duplicate)
        {
            GD.PushWarning(
                $"Kirie dropped WebView permission request {requestId} before it was resolved.");
        }
    }

    private bool HasSameOrigin(string origin)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var requestOrigin))
        {
            return false;
        }

        return StringComparer.OrdinalIgnoreCase.Equals(_trustedOrigin.Scheme, requestOrigin.Scheme)
            && StringComparer.OrdinalIgnoreCase.Equals(_trustedOrigin.IdnHost, requestOrigin.IdnHost)
            && _trustedOrigin.Port == requestOrigin.Port;
    }

    private static Uri ParseOrigin(string rendererUrl)
    {
        if (!Uri.TryCreate(rendererUrl, UriKind.Absolute, out var origin))
        {
            throw new InvalidOperationException("The renderer URL must have an absolute origin.");
        }

        return origin;
    }
}
