using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Eventa;
using Godot;
using HttpClient = System.Net.Http.HttpClient;

/// <summary>
/// The scene model in the Kirie host: what a screen without text shows. The renderer asks
/// on the "dahlia:scene" channel: {op: 'status'} whether its files are here, {op: 'install'}
/// to get them from Dahlia's server (each checked against its SHA-256 before it is kept),
/// and {op: 'describe', rgb, width, height} for what a picture shows.
/// A port of Electron's src/main/dahlia-scene-model.ts.
///
/// Difference from Electron: Electron ran the model (Mirage, ~22 MB of JS+WASM) in a worker
/// thread. The Kirie host has no JS worker, so describe answers that the model isn't
/// available; the renderer then watches on without a scene, exactly like Electron did when
/// her server had no model files or anything failed. File management (status/install) is
/// kept so a future native runner can pick the files up.
/// </summary>
internal sealed class DahliaSceneModelService : IDisposable
{
    public sealed record SceneFile(string Name, string Sha256);

    public static readonly IReadOnlyList<SceneFile> SceneFiles = new List<SceneFile>
    {
        new("cactus.js", "bb61bcf0c48712bfb9cd0ade8f0748889dfde9944ac308220f42abbc605f82bc"),
        new("cactus.wasm", "4198b30795ded7739fe6c9e80bf26d5a844767c081574d40c8dc0477cde8b4b6"),
        new("mirage.cact", "4249a0f751f27b941b6ec7d7f4be1ce7e6f237b24b15c6fb4f17fce1e66f9e237"),
    };

    private readonly string _dir;
    private readonly HttpClient _http;
    private readonly IDisposable _registration;
    private readonly bool _ownsHttp;
    private bool _disposed;
    private bool? _checked;

    public DahliaSceneModelService(string dir, HttpClient http, IDisposable registration, bool ownsHttp)
    {
        _dir = dir;
        _http = http;
        _registration = registration;
        _ownsHttp = ownsHttp;
    }

    public static string DefaultDir()
    {
        return Path.Combine(OS.GetUserDataDir(), "dahlia-scene-model");
    }

    public static string Sha256Hex(byte[] data)
    {
        return Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    }

    /// <summary>Whether every file is here with the right content.</summary>
    public bool Installed()
    {
        foreach (var file in SceneFiles)
        {
            var path = Path.Combine(_dir, file.Name);
            if (!File.Exists(path))
                return false;
            try
            {
                if (Sha256Hex(File.ReadAllBytes(path)) != file.Sha256)
                    return false;
            }
            catch
            {
                return false;
            }
        }
        return true;
    }

    public async Task InstallAsync(string @base, IReadOnlyDictionary<string, string> headers, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_dir);
        foreach (var file in SceneFiles)
        {
            var path = Path.Combine(_dir, file.Name);
            if (File.Exists(path))
            {
                try
                {
                    if (Sha256Hex(await File.ReadAllBytesAsync(path, cancellationToken)) == file.Sha256)
                        continue;
                }
                catch
                {
                    // Re-fetch below.
                }
            }
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{@base.TrimEnd('/')}/api/v1/dahlia/models/scene/{file.Name}");
            foreach (var (key, value) in headers)
            {
                if (!request.Headers.TryAddWithoutValidation(key, value))
                    request.Content?.Headers.TryAddWithoutValidation(key, value);
            }
            using var response = await _http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException(response.StatusCode == System.Net.HttpStatusCode.NotFound
                    ? "Dahlia's server doesn't have the scene model."
                    : $"Dahlia's server answered {(int)response.StatusCode} for {file.Name}.");
            }
            var data = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            // Code and weights that run in this app: only the exact files that were tried are kept.
            if (Sha256Hex(data) != file.Sha256)
                throw new InvalidOperationException($"{file.Name} from Dahlia's server isn't the file expected.");
            var part = $"{path}.part";
            await File.WriteAllBytesAsync(part, data, cancellationToken);
            File.Move(part, path, overwrite: true);
        }
        _checked = true;
    }

    public static DahliaSceneModelService Attach(IEventContext context, string? dir = null, HttpClient? http = null)
    {
        var resolvedDir = dir ?? DefaultDir();
        var client = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        DahliaSceneModelService? service = null;
        var registration = context.RegisterInvokeHandler(
            DahliaEvents.SceneCall,
            async (DahliaHostCallRequest payload, CancellationToken cancellationToken) =>
            {
                try
                {
                    var request = JsonNode.Parse(payload.Json) as JsonObject
                        ?? DahliaWindowHelper.ErrorNode("Unknown request.");
                    return DahliaContracts.Answer(await service!.HandleAsync(request, cancellationToken));
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception error)
                {
                    return DahliaContracts.OkError(error.Message.Length > 0 ? error.Message : "That failed.");
                }
            });
        service = new DahliaSceneModelService(resolvedDir, client, registration, http is null);
        return service;
    }

    internal async Task<JsonObject> HandleAsync(JsonObject request, CancellationToken cancellationToken)
    {
        var op = request["op"]?.GetValue<string>();
        switch (op)
        {
            case "status":
                _checked ??= Installed();
                return new JsonObject { ["ok"] = true, ["installed"] = _checked.Value };
            case "install":
            {
                var headers = new Dictionary<string, string>();
                foreach (var (key, value) in request)
                {
                    if (key is "op" or "base" or "headers")
                        continue;
                    if (value?.GetValue<string>() is { } flat)
                        headers[key] = flat;
                }
                // Electron passed the auth headers object as "headers"; accept both shapes.
                if (request["headers"] is JsonObject nested)
                {
                    foreach (var (key, value) in nested)
                    {
                        if (value?.GetValue<string>() is { } text)
                            headers[key] = text;
                    }
                }
                await InstallAsync(DahliaContracts.GetString(request, "base"), headers, cancellationToken);
                return new JsonObject { ["ok"] = true, ["installed"] = true };
            }
            case "describe":
                if (!(_checked ??= Installed()))
                    return DahliaWindowHelper.ErrorNode("The scene model isn't installed.");
                // The Kirie host has no model runner; her screen watching goes on without a scene.
                return DahliaWindowHelper.ErrorNode("The scene model isn't available in the Kirie host.");
            default:
                return DahliaWindowHelper.ErrorNode("Unknown request.");
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _registration.Dispose();
        if (_ownsHttp)
            _http.Dispose();
    }
}
