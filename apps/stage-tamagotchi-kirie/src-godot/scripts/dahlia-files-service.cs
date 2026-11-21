using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;

/// <summary>
/// Dahlia: lets Dahlia look up and read files on this computer, through the
/// read-only MCP server in <c>dahlia-files-mcp.mjs</c>. Its entry in
/// <c>mcp.json</c> is added once; after that the user's choices stay: removing
/// the entry or setting <c>"enabled": false</c> keeps it off, and folders
/// listed after the script path replace the default folders. Each start
/// updates the executable and script paths, which change when the app moves.
///
/// Port of Electron's <c>src/main/dahlia-files.ts</c>
/// (<c>withDahliaFilesServer</c>, <c>ensureDahliaFilesServer</c>): the same
/// entry shape (<c>command</c>, <c>args: [script, ...folders]</c>,
/// <c>env: { ELECTRON_RUN_AS_NODE: 1 }</c>) and the same add-once/refresh
/// behaviour. The server script ships beside the host executable; where it
/// doesn't, setup warns and leaves <c>mcp.json</c> alone.
/// </summary>
internal static class DahliaFilesService
{
    public const string ServerName = "dahlia-files";

    /// <summary>Written to userData once the entry was added, so a removed entry stays removed.</summary>
    private const string AddedMarker = "dahlia-files-mcp-added";

    /// <summary>
    /// The mcp.json text with Dahlia's file server added or its paths brought
    /// up to date, or null when nothing changes. A file the user broke stays
    /// as it is; the settings page shows the error.
    /// </summary>
    public static string? WithDahliaFilesServer(string configText, string command, string script, bool addIfMissing)
    {
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(configText);
        }
        catch
        {
            return null;
        }

        if (root is not JsonObject config)
        {
            return null;
        }

        if (config["mcpServers"] is not JsonObject servers)
        {
            if (config["mcpServers"] is not null)
            {
                return null;
            }

            servers = new JsonObject();
            config["mcpServers"] = servers;
        }

        var existing = servers[ServerName];
        if (existing is not JsonObject current)
        {
            if (existing is not null || !addIfMissing)
            {
                return null;
            }

            servers[ServerName] = new JsonObject
            {
                ["command"] = command,
                ["args"] = new JsonArray(script),
                ["env"] = new JsonObject { ["ELECTRON_RUN_AS_NODE"] = "1" },
            };
        }
        else
        {
            if (current["command"]?.GetValue<string>() is not string)
            {
                return null;
            }

            var folders = current["args"] is JsonArray args
                ? args.Skip(1).Select(argument => argument?.GetValue<string>() ?? string.Empty).ToArray()
                : [];
            var env = current["env"] as JsonObject;
            if (current["command"]!.GetValue<string>() == command
                && current["args"] is JsonArray currentArgs
                && currentArgs.Count > 0
                && currentArgs[0]?.GetValue<string>() == script
                && env?["ELECTRON_RUN_AS_NODE"]?.GetValue<string>() == "1")
            {
                return null;
            }

            var foldersArray = new JsonArray(script);
            foreach (var folder in folders)
            {
                foldersArray.Add(folder);
            }

            var next = new JsonObject
            {
                ["command"] = command,
                ["args"] = foldersArray,
                ["env"] = new JsonObject { ["ELECTRON_RUN_AS_NODE"] = "1" },
            };
            if (env is not null)
            {
                foreach (var (key, value) in env)
                {
                    if (key != "ELECTRON_RUN_AS_NODE")
                    {
                        next["env"]![key] = value?.DeepClone();
                    }
                }
            }

            foreach (var (key, value) in current)
            {
                if (key is not ("command" or "args" or "env"))
                {
                    next[key] = value?.DeepClone();
                }
            }

            servers[ServerName] = next;
        }

        return config.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
    }

    /// <summary>
    /// Adds Dahlia's file server to mcp.json the first time, and keeps its
    /// paths right after that. Never throws and never stops the app: a
    /// problem here must not keep her from starting.
    /// </summary>
    public static bool Ensure(string userDataDir, string command, string scriptPath)
    {
        try
        {
            if (!File.Exists(scriptPath))
            {
                GD.PushWarning($"Dahlia: no file server script at {scriptPath}; leaving mcp.json alone.");
                return false;
            }

            var configPath = Path.Combine(userDataDir, "mcp.json");
            var markerPath = Path.Combine(userDataDir, AddedMarker);
            string configText;
            try
            {
                configText = File.ReadAllText(configPath);
            }
            catch (Exception error)
            {
                GD.PushWarning($"Dahlia: could not set up the file server: {error.Message}");
                return false;
            }

            var added = File.Exists(markerPath);
            var next = WithDahliaFilesServer(configText, command, scriptPath, !added);
            if (next is not null)
            {
                File.WriteAllText(configPath, next);
            }

            if (!added)
            {
                File.WriteAllText(markerPath, DateTime.UtcNow.ToString("o") + "\n");
            }

            return true;
        }
        catch (Exception error)
        {
            GD.PushWarning($"Dahlia: could not set up the file server: {error.Message}");
            return false;
        }
    }
}
