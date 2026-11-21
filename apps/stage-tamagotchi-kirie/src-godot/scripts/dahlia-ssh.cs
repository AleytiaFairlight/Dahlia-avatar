using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Nodes;
using Eventa;

/// <summary>
/// Dahlia's SSH from this PC (her <c>ssh</c>, <c>ssh_key</c>,
/// <c>ssh_install_key</c> and <c>ssh_save_password</c> tools), on
/// <c>eventa:invoke:dahlia:ssh:run</c>, and Settings &gt; Dahlia &gt; SSH on
/// <c>eventa:invoke:dahlia:ssh-settings:get</c>. She gives the host, the user
/// and the command; the login is this PC's key (<c>~/.ssh/id_ed25519</c>, made
/// here if there is none, which <c>ssh</c> in PowerShell uses too) or a saved
/// password, kept encrypted with Windows' DPAPI. A Settings-saved password
/// never reaches her, the chat or the logs; a chat-told one arrives through
/// her server (ssh_save_password) and is encrypted at rest after that. A
/// server's host key is trusted the first time and checked after that.
///
/// Port of Electron's <c>src/main/dahlia-ssh.ts</c> (<c>parseSshTarget</c>,
/// <c>sshFingerprint</c>, <c>sshTargetName</c>, <c>ensureSshKey</c>,
/// <c>saveSshPassword</c>, <c>runDahliaSsh</c>, <c>dahliaSshSettings</c>).
///
/// Difference from Electron: Electron logged in with the ssh2 library, which
/// could answer password and keyboard-interactive prompts in-process. The
/// Kirie host has no SSH library, so it drives the system's OpenSSH client
/// (<c>ssh</c>, <c>ssh-keygen</c>, <c>ssh-keyscan</c>): host keys are checked
/// with <c>ssh-keyscan</c> against this host's own known-hosts file before any
/// login, key logins pass this PC's key files with <c>-i</c>, and password
/// logins need <c>sshpass</c> — without it (and without a key) the answer says
/// how to log in instead. OpenSSH's <c>ssh.exe</c> can't take a password
/// without a console, which is why the helper is needed.
/// </summary>
internal sealed record DahliaSshTarget(string Host, string User, int Port);

/// <summary>
/// Where the key, the passwords and the host keys are kept, and how passwords
/// are encrypted: swapped in tests.
/// </summary>
internal sealed class DahliaSshStore
{
    public string SshDirectory { get; set; } = string.Empty;
    public string DataDirectory { get; set; } = string.Empty;
    public Func<bool> CanEncrypt { get; set; } = () => false;
    public Func<string, string> Encrypt { get; set; } = _ => throw new InvalidOperationException("This PC can't encrypt passwords, so none is saved.");
    public Func<string, string> Decrypt { get; set; } = _ => throw new InvalidOperationException("This PC can't decrypt passwords.");
}

internal static class DahliaSsh
{
    public const int MaxOutput = 16_000;
    private const int DefaultTimeoutMs = 60_000;
    private const int MaxTimeoutMs = 300_000;
    private const int ConnectTimeoutSeconds = 15;

    /// <summary>This PC's keys that the login tries, in order: the one made here comes first.</summary>
    public static readonly IReadOnlyList<string> KeyFiles = new List<string> { "id_ed25519", "id_ecdsa", "id_rsa" };

    private const string PasswordsFileName = "dahlia-ssh-passwords.json";
    private const string KnownHostsFileName = "dahlia-ssh-known-hosts";

    public static DahliaSshStore DefaultStore()
    {
        var store = new DahliaSshStore
        {
            SshDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".ssh"),
            DataDirectory = Godot.OS.GetUserDataDir(),
        };
        store.CanEncrypt = () => OperatingSystem.IsWindows() && DahliaWindowsDataProtection.IsAvailable();
        store.Encrypt = text => ProtectPassword(text);
        store.Decrypt = data => UnprotectPassword(data);
        return store;
    }

    private static string ProtectPassword(string text)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("This PC can't encrypt passwords, so none is saved.");
        return DahliaWindowsDataProtection.Protect(text);
    }

    private static string UnprotectPassword(string data)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException("The saved password couldn't be read.");
        return DahliaWindowsDataProtection.Unprotect(data);
    }

    /// <summary>A login's name in the password list: user@host:port, the host in lower case.</summary>
    public static string SshTargetName(DahliaSshTarget target) =>
        $"{target.User}@{target.Host.Trim().ToLowerInvariant()}:{target.Port}";

    /// <summary>"user@host:2222" or a host with the user apart: the target, or an error to tell her.</summary>
    public static (DahliaSshTarget? Target, string? Error) ParseSshTarget(string? host, string? user, int? port)
    {
        var parsedHost = host?.Trim() ?? string.Empty;
        var parsedUser = user?.Trim() ?? string.Empty;
        int? parsedPort = port is > 0 ? port : null;
        var at = parsedHost.LastIndexOf('@');
        if (at > 0)
        {
            if (parsedUser.Length == 0)
                parsedUser = parsedHost[..at];
            parsedHost = parsedHost[(at + 1)..];
        }
        var colon = System.Text.RegularExpressions.Regex.Match(parsedHost, "^([^:]+):(\\d+)$");
        if (colon.Success)
        {
            parsedHost = colon.Groups[1].Value;
            parsedPort ??= int.TryParse(colon.Groups[2].Value, out var colonPort) ? colonPort : null;
        }
        if (parsedHost.Length == 0 || !System.Text.RegularExpressions.Regex.IsMatch(parsedHost, "^[\\w.-]+$"))
            return (null, "Give the server as a host name or an IP address.");
        if (parsedUser.Length == 0 || !System.Text.RegularExpressions.Regex.IsMatch(parsedUser, "^[\\w.@-]+$"))
            return (null, "Give the user name to log in as.");
        if (parsedPort is < 1 or > 65535)
            return (null, "The port must be 1 to 65535.");
        return (new DahliaSshTarget(parsedHost, parsedUser, parsedPort ?? 22), null);
    }

    /// <summary>OpenSSH's fingerprint of a host key: SHA256: and the hash in Base64 without padding.</summary>
    public static string SshFingerprint(byte[] key) =>
        $"SHA256:{Convert.ToBase64String(SHA256.HashData(key)).TrimEnd('=')}";

    private static string PasswordsFile(DahliaSshStore store) => Path.Combine(store.DataDirectory, PasswordsFileName);
    internal static string KnownHostsFile(DahliaSshStore store) => Path.Combine(store.DataDirectory, KnownHostsFileName);

    internal static async Task<Dictionary<string, string>> ReadPasswordsAsync(DahliaSshStore store)
    {
        try
        {
            var text = await File.ReadAllTextAsync(PasswordsFile(store));
            return JsonSerializer.Deserialize(text, DahliaSshJsonContext.Default.DictionaryStringString)
                ?? new Dictionary<string, string>();
        }
        catch
        {
            return new Dictionary<string, string>();
        }
    }

    private static async Task WritePasswordsAsync(DahliaSshStore store, Dictionary<string, string> passwords)
    {
        Directory.CreateDirectory(store.DataDirectory);
        await File.WriteAllTextAsync(
            PasswordsFile(store),
            JsonSerializer.Serialize(passwords, DahliaSshJsonContext.Default.DictionaryStringString));
    }

    /// <summary>The trusted host keys: host ("host:port", lower-cased host) to its OpenSSH file line.</summary>
    internal static async Task<Dictionary<string, string>> ReadKnownHostsAsync(DahliaSshStore store)
    {
        var hosts = new Dictionary<string, string>(StringComparer.Ordinal);
        string[] lines;
        try
        {
            lines = await File.ReadAllLinesAsync(KnownHostsFile(store));
        }
        catch
        {
            return hosts;
        }
        foreach (var line in lines)
        {
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 3)
                continue;
            hosts[HostKeyName(parts[0])] = line;
        }
        return hosts;
    }

    private static string HostKeyName(string firstField)
    {
        // OpenSSH marks a nonstandard port as [host]:port.
        if (firstField.StartsWith('[') && firstField.EndsWith(']') is false)
        {
            var end = firstField.IndexOf("]:", StringComparison.Ordinal);
            if (end > 0 && int.TryParse(firstField[(end + 2)..], out var bracketPort))
                return $"{firstField[1..end].ToLowerInvariant()}:{bracketPort}";
        }
        return $"{firstField.ToLowerInvariant()}:22";
    }

    internal static string HostKeyName(DahliaSshTarget target) => $"{target.Host.ToLowerInvariant()}:{target.Port}";

    internal static string KnownHostsLine(DahliaSshTarget target, string keyType, string keyBase64) =>
        target.Port == 22
            ? $"{target.Host} {keyType} {keyBase64}"
            : $"[{target.Host}]:{target.Port} {keyType} {keyBase64}";

    private static async Task WriteKnownHostsAsync(DahliaSshStore store, Dictionary<string, string> hosts)
    {
        Directory.CreateDirectory(store.DataDirectory);
        var lines = hosts.OrderBy(entry => entry.Key, StringComparer.Ordinal).Select(entry => entry.Value);
        await File.WriteAllLinesAsync(KnownHostsFile(store), lines);
    }

    /// <summary>This PC's public key line, made with its private key (~/.ssh/id_ed25519) when there is none.</summary>
    public static async Task<string?> EnsureSshKeyAsync(DahliaSshStore store, bool create = true, CancellationToken cancellationToken = default)
    {
        var privateFile = Path.Combine(store.SshDirectory, "id_ed25519");
        var publicFile = $"{privateFile}.pub";
        try
        {
            if (File.Exists(publicFile))
                return (await File.ReadAllTextAsync(publicFile, cancellationToken)).Trim();
        }
        catch
        {
            return null;
        }
        if (!create || !FindOnPath("ssh-keygen"))
            return null;
        try
        {
            Directory.CreateDirectory(store.SshDirectory);
            var name = OperatingSystem.IsWindows() ? Environment.MachineName : Environment.GetEnvironmentVariable("HOSTNAME") ?? "dahlia";
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "ssh-keygen",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                },
            };
            process.StartInfo.ArgumentList.Add("-t");
            process.StartInfo.ArgumentList.Add("ed25519");
            process.StartInfo.ArgumentList.Add("-N");
            process.StartInfo.ArgumentList.Add(string.Empty);
            process.StartInfo.ArgumentList.Add("-f");
            process.StartInfo.ArgumentList.Add(privateFile);
            process.StartInfo.ArgumentList.Add("-C");
            process.StartInfo.ArgumentList.Add($"dahlia@{name}");
            process.Start();
            await process.WaitForExitAsync(cancellationToken);
            if (process.ExitCode != 0 || !File.Exists(publicFile))
                return null;
            return (await File.ReadAllTextAsync(publicFile, cancellationToken)).Trim();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Keeps a login's password, encrypted.</summary>
    public static async Task SaveSshPasswordAsync(DahliaSshTarget target, string password, DahliaSshStore store)
    {
        if (!store.CanEncrypt())
            throw new InvalidOperationException("This PC can't encrypt passwords, so none is saved.");
        var passwords = await ReadPasswordsAsync(store);
        passwords[SshTargetName(target)] = store.Encrypt(password);
        await WritePasswordsAsync(store, passwords);
    }

    private static async Task<string?> SavedPasswordAsync(DahliaSshTarget target, DahliaSshStore store)
    {
        var passwords = await ReadPasswordsAsync(store);
        if (!passwords.TryGetValue(SshTargetName(target), out var saved))
            return null;
        try
        {
            return store.Decrypt(saved);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>This PC's key files that exist (passphraseless ones log in with BatchMode).</summary>
    internal static List<string> ExistingKeyFiles(DahliaSshStore store)
    {
        var files = new List<string>();
        foreach (var name in KeyFiles)
        {
            try
            {
                var file = Path.Combine(store.SshDirectory, name);
                if (File.Exists(file))
                    files.Add(file);
            }
            catch
            {
                // An unreadable key directory holds no login.
            }
        }
        return files;
    }

    internal static bool FindOnPath(string name)
    {
        var file = OperatingSystem.IsWindows() && !name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? $"{name}.exe" : name;
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                if (File.Exists(Path.Combine(dir.Trim(), file)))
                    return true;
            }
            catch
            {
                // An unreadable PATH entry holds no binary.
            }
        }
        return false;
    }

    /// <summary>The server's host key, asked from the server itself. Throws when unreachable.</summary>
    internal static async Task<(string KeyType, string KeyBase64)> ScanHostKeyAsync(
        DahliaSshTarget target, CancellationToken cancellationToken)
    {
        if (!FindOnPath("ssh-keyscan"))
            throw new InvalidOperationException($"{target.Host} couldn't be reached: ssh-keyscan isn't installed with OpenSSH.");
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "ssh-keyscan",
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
        };
        process.StartInfo.ArgumentList.Add("-p");
        process.StartInfo.ArgumentList.Add(target.Port.ToString());
        process.StartInfo.ArgumentList.Add("-t");
        process.StartInfo.ArgumentList.Add("ed25519,ecdsa,rsa");
        process.StartInfo.ArgumentList.Add(target.Host);
        var output = new StringBuilder();
        process.OutputDataReceived += (_, args) =>
        {
            if (args.Data is not null)
                output.AppendLine(args.Data);
        };
        try
        {
            process.Start();
        }
        catch (Exception error)
        {
            throw new InvalidOperationException($"{target.Host} couldn't be reached: {error.Message}");
        }
        process.BeginOutputReadLine();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(ConnectTimeoutSeconds));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        try
        {
            await process.WaitForExitAsync(linked.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            try { process.Kill(); } catch { }
            throw new InvalidOperationException($"{target.Host} couldn't be reached: the host key scan timed out.");
        }
        foreach (var line in output.ToString().Split('\n'))
        {
            // "[host]:port keytype base64" or "host keytype base64"; comments start with '#'.
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 3 && !parts[0].StartsWith('#'))
                return (parts[1], parts[2]);
        }
        throw new InvalidOperationException($"{target.Host} couldn't be reached: no host key was offered.");
    }

    /// <summary>
    /// Trusts the host key on the first connection (says so in the output) and
    /// refuses a changed key. Returns the note for the first connection, if any.
    /// </summary>
    internal static async Task<string?> CheckHostKeyAsync(
        DahliaSshTarget target, DahliaSshStore store, CancellationToken cancellationToken)
    {
        var (keyType, keyBase64) = await ScanHostKeyAsync(target, cancellationToken);
        byte[] key;
        try
        {
            key = Convert.FromBase64String(keyBase64);
        }
        catch
        {
            throw new InvalidOperationException($"{target.Host} couldn't be reached: its host key didn't parse.");
        }
        var fingerprint = SshFingerprint(key);
        var hosts = await ReadKnownHostsAsync(store);
        var name = HostKeyName(target);
        if (hosts.TryGetValue(name, out var line))
        {
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 3 && parts[2] == keyBase64)
                return null;
            var knownPrint = parts.Length >= 3 ? FingerprintOf(parts[2]) : null;
            throw new InvalidOperationException(
                $"The host key of {name} changed (it was {knownPrint ?? "unknown"}, now {fingerprint}), so nothing was sent: someone may be in between. "
                + "If the server was set up again, forget its key in Settings > Dahlia > SSH on this PC.");
        }
        hosts[name] = KnownHostsLine(target, keyType, keyBase64);
        await WriteKnownHostsAsync(store, hosts);
        return $"First connection to {name}: its host key {fingerprint} is trusted from now on.";
    }

    private static string? FingerprintOf(string keyBase64)
    {
        try
        {
            return SshFingerprint(Convert.FromBase64String(keyBase64));
        }
        catch
        {
            return null;
        }
    }

    /// <summary>A POSIX shell single-quoted word: safe to send through <c>ssh host '...'</c>.</summary>
    public static string QuotePosix(string command) => $"'{command.Replace("'", "'\\''")}'";

    private sealed record SshRunResult(int? ExitCode, string Stdout, string Stderr, bool TimedOut);

    private static async Task<SshRunResult> RunSshAsync(
        DahliaSshTarget target,
        string remoteCommand,
        IReadOnlyList<string> keyFiles,
        string? password,
        int timeoutMs,
        DahliaSshStore store,
        CancellationToken cancellationToken)
    {
        var useSshPass = password is not null && FindOnPath("sshpass");
        var file = useSshPass ? "sshpass" : "ssh";
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = file,
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            },
        };
        if (useSshPass)
        {
            process.StartInfo.ArgumentList.Add("-p");
            process.StartInfo.ArgumentList.Add(password!);
            process.StartInfo.ArgumentList.Add("-e");
            process.StartInfo.ArgumentList.Add("none");
            process.StartInfo.ArgumentList.Add("ssh");
        }
        process.StartInfo.ArgumentList.Add("-p");
        process.StartInfo.ArgumentList.Add(target.Port.ToString());
        foreach (var keyFile in keyFiles)
        {
            process.StartInfo.ArgumentList.Add("-i");
            process.StartInfo.ArgumentList.Add(keyFile);
        }
        process.StartInfo.ArgumentList.Add("-o");
        process.StartInfo.ArgumentList.Add("BatchMode=yes");
        process.StartInfo.ArgumentList.Add("-o");
        process.StartInfo.ArgumentList.Add($"ConnectTimeout={ConnectTimeoutSeconds}");
        process.StartInfo.ArgumentList.Add("-o");
        process.StartInfo.ArgumentList.Add("StrictHostKeyChecking=yes");
        process.StartInfo.ArgumentList.Add("-o");
        process.StartInfo.ArgumentList.Add($"UserKnownHostsFile={KnownHostsFile(store)}");
        process.StartInfo.ArgumentList.Add($"{target.User}@{target.Host}");
        process.StartInfo.ArgumentList.Add(QuotePosix(remoteCommand));

        var stdout = new StringBuilder();
        var stderr = new StringBuilder();
        process.OutputDataReceived += (_, args) =>
        {
            if (args.Data is not null)
                stdout.AppendLine(args.Data);
        };
        process.ErrorDataReceived += (_, args) =>
        {
            if (args.Data is not null)
                stderr.AppendLine(args.Data);
        };
        try
        {
            process.Start();
        }
        catch (Exception error)
        {
            return new SshRunResult(null, string.Empty, error.Message, false);
        }
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        var timedOut = false;
        try
        {
            using var timeout = new CancellationTokenSource(timeoutMs);
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
            await process.WaitForExitAsync(linked.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            timedOut = true;
            DahliaProcessTrees.Stop(process);
        }
        if (!timedOut)
        {
            try
            {
                await process.WaitForExitAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                timedOut = true;
                DahliaProcessTrees.Stop(process);
                await process.WaitForExitAsync(CancellationToken.None);
            }
        }
        else
        {
            try
            {
                await process.WaitForExitAsync(CancellationToken.None);
            }
            catch
            {
                // The tree is killed; whatever is left goes with the process.
            }
        }

        int? exitCode = null;
        if (!timedOut)
        {
            try
            {
                exitCode = process.HasExited ? process.ExitCode : null;
            }
            catch
            {
                exitCode = null;
            }
        }
        return new SshRunResult(exitCode, stdout.ToString(), stderr.ToString(), timedOut);
    }

    private static DahliaSshResultPayload FormatResult(
        SshRunResult run, int timeoutMs, string? note, string loginDescription)
    {
        var output = run.Stdout;
        if (run.Stderr.Trim().Length > 0)
            output += $"{(output.Length > 0 && !output.EndsWith('\n') ? "\n" : "")}[stderr]\n{run.Stderr}";
        if (output.Length > MaxOutput)
            output = $"{output[..MaxOutput]}\n[output cut at {MaxOutput} characters]";
        if (run.TimedOut)
            output += $"\n[stopped after {Math.Round(timeoutMs / 1000.0)} seconds]";
        output = output.Length > 0 ? output : "(no output)";
        if (note is not null)
            output = $"{note}\n{output}";
        if (!run.TimedOut && run.ExitCode is null)
        {
            var refused = run.Stderr.Contains("Permission denied", StringComparison.Ordinal);
            output = refused
                ? $"The login was refused ({loginDescription}). Save the right password in Settings > Dahlia > SSH, or install this PC's key on the server with ssh_install_key."
                : $"{loginDescription} couldn't be reached: {LastLine(run.Stderr)}";
            return new DahliaSshResultPayload(false, null, output);
        }
        return new DahliaSshResultPayload(!run.TimedOut && run.ExitCode == 0, run.ExitCode, output);
    }

    private static string LastLine(string text)
    {
        var lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        return lines.Length > 0 ? lines[^1].Trim() : "no reason given";
    }

    /// <summary>Answers one tool request.</summary>
    public static async Task<DahliaSshResultPayload> RunAsync(
        DahliaSshRequestPayload request,
        DahliaSshStore? store = null,
        CancellationToken cancellationToken = default)
    {
        store ??= DefaultStore();
        try
        {
            if (request.Op == "key")
            {
                var existed = File.Exists(Path.Combine(store.SshDirectory, "id_ed25519"));
                var key = await EnsureSshKeyAsync(store, cancellationToken: cancellationToken);
                if (key is null)
                    return new DahliaSshResultPayload(false, null, "This PC's key (~/.ssh/id_ed25519) has a passphrase or couldn't be made, so Dahlia can't use it. Save the server's password in Settings > Dahlia > SSH instead.");
                return new DahliaSshResultPayload(true, 0,
                    $"{(existed ? "This PC's public key" : "Made this PC's key (~/.ssh/id_ed25519). Its public key")}:\n{key}\n\n"
                    + "A server accepts it once this line is in ~/.ssh/authorized_keys of the user there: ssh_install_key adds it with the saved password.");
            }

            var (target, targetError) = ParseSshTarget(request.Host, request.User, request.Port);
            if (target is null)
                return new DahliaSshResultPayload(false, null, targetError ?? "That server failed.");

            if (request.Op == "save-password")
            {
                // Dahlia may save what the user told her in chat (ssh_save_password tool): it arrives through her
                // server. It is kept encrypted on this PC and never comes back out.
                var chatPassword = request.Password ?? string.Empty;
                if (chatPassword.Length == 0)
                    return new DahliaSshResultPayload(false, null, "Give the password to save.");
                try
                {
                    await SaveSshPasswordAsync(target, chatPassword, store);
                }
                catch (InvalidOperationException error)
                {
                    return new DahliaSshResultPayload(false, null, error.Message);
                }
                return new DahliaSshResultPayload(true, 0, $"Saved the password for {SshTargetName(target)} on this PC (encrypted). Later ssh logins use it; ssh_install_key can now install this PC's key so logins need no password.");
            }

            var keyFiles = ExistingKeyFiles(store);
            var password = await SavedPasswordAsync(target, store);

            if (request.Op == "install_key")
            {
                var installKey = await EnsureSshKeyAsync(store, cancellationToken: cancellationToken);
                if (installKey is null)
                    return new DahliaSshResultPayload(false, null, "This PC's key has a passphrase or couldn't be made, so it can't be installed for Dahlia.");
                if (keyFiles.Count == 0 && password is null)
                    return NoLogin(target, keyFiles, password);
                // The key line holds only Base64, its type and a host name, so single quotes keep it whole.
                var line = installKey.Replace("'", string.Empty);
                var command = $"umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && (grep -qxF '{line}' ~/.ssh/authorized_keys || echo '{line}' >> ~/.ssh/authorized_keys) && echo installed";
                var install = await LoggedInRunAsync(target, command, DefaultTimeoutMs, keyFiles, password, store, cancellationToken);
                if (install is null)
                    return ChangedKey(target);
                if (!install.Ok)
                    return new DahliaSshResultPayload(false, install.Result.ExitCode, $"The key couldn't be added (the server needs a POSIX shell): {install.Result.Output}");
                // The key alone must log in now.
                var check = await LoggedInRunAsync(target, "echo installed", DefaultTimeoutMs, keyFiles, null, store, cancellationToken);
                var prefix = install.Note is not null ? $"{install.Note}\n" : string.Empty;
                return check is { Ok: true }
                    ? new DahliaSshResultPayload(true, 0, $"{prefix}This PC's key is installed for {SshTargetName(target)}: logins need no password from now on.")
                    : new DahliaSshResultPayload(false, null, $"{prefix}The key is in ~/.ssh/authorized_keys, but the server still refuses it: save the right password in Settings > Dahlia > SSH and try again.");
            }

            if (request.Op is not "run")
                return new DahliaSshResultPayload(false, null, "Unknown request.");

            var remoteCommand = request.Command ?? string.Empty;
            if (remoteCommand.Trim().Length == 0)
                return new DahliaSshResultPayload(false, null, "Give the command to run.");
            if (keyFiles.Count == 0 && password is null)
                return NoLogin(target, keyFiles, password);
            var timeoutMs = Math.Min(
                MaxTimeoutMs,
                Math.Max(1_000, (int)((request.TimeoutSeconds is double seconds && seconds > 0 ? seconds : DefaultTimeoutMs / 1000.0) * 1000)));
            var run = await LoggedInRunAsync(target, remoteCommand, timeoutMs, keyFiles, password, store, cancellationToken);
            if (run is null)
                return ChangedKey(target);
            return run.Result;
        }
        catch (InvalidOperationException error)
        {
            return new DahliaSshResultPayload(false, null, error.Message);
        }
    }

    private sealed record LoggedIn(DahliaSshResultPayload Result, string? Note, bool Ok);

    private static async Task<LoggedIn?> LoggedInRunAsync(
        DahliaSshTarget target,
        string remoteCommand,
        int timeoutMs,
        IReadOnlyList<string> keyFiles,
        string? password,
        DahliaSshStore store,
        CancellationToken cancellationToken)
    {
        string? note;
        try
        {
            note = await CheckHostKeyAsync(target, store, cancellationToken);
        }
        catch (InvalidOperationException error) when (error.Message.Contains("changed", StringComparison.Ordinal))
        {
            return null;
        }
        var login = LoginDescription(target, keyFiles, password);
        string? effectivePassword = password;
        if (password is not null && keyFiles.Count > 0 && !FindOnPath("sshpass"))
        {
            // No helper to answer a password prompt: keys first, the refusal below says the rest.
            effectivePassword = null;
        }
        if (effectivePassword is null && password is not null && keyFiles.Count == 0 && !FindOnPath("sshpass"))
            return new LoggedIn(
                new DahliaSshResultPayload(false, null,
                    $"The login to {login} needs its password, but sshpass isn't installed to answer it. Install this PC's key on the server with ssh_install_key, or install sshpass."),
                note, false);
        var run = await RunSshAsync(target, remoteCommand, keyFiles, effectivePassword, timeoutMs, store, cancellationToken);
        return new LoggedIn(FormatResult(run, timeoutMs, note, login), note, !run.TimedOut && run.ExitCode == 0);
    }

    private static string LoginDescription(DahliaSshTarget target, IReadOnlyList<string> keyFiles, string? password)
    {
        var name = $"{target.User}@{target.Host}{(target.Port != 22 ? $":{target.Port}" : "")}";
        var how = string.Join(" and ", new[] { keyFiles.Count > 0 ? "this PC's key" : null, password is not null ? "the saved password" : null }.Where(part => part is not null));
        return how.Length > 0 ? $"{name} ({how})" : name;
    }

    private static DahliaSshResultPayload NoLogin(DahliaSshTarget target, IReadOnlyList<string> keyFiles, string? password)
    {
        var name = LoginDescription(target, keyFiles, password);
        return new DahliaSshResultPayload(false, null,
            $"There is no way to log in to {name}: this PC has no key without a passphrase and no saved password. Create the key with ssh_key, or save the password in Settings > Dahlia > SSH on this PC.");
    }

    private static DahliaSshResultPayload ChangedKey(DahliaSshTarget target) =>
        new(false, null, $"The host key of {HostKeyName(target)} changed, so nothing was sent: someone may be in between. If the server was set up again, forget its key in Settings > Dahlia > SSH on this PC.");

    /// <summary>Answers Settings &gt; Dahlia &gt; SSH. A password goes in, never out.</summary>
    public static async Task<DahliaSshSettingsPayload> SettingsAsync(
        DahliaSshSettingsRequestPayload request,
        DahliaSshStore? store = null,
        CancellationToken cancellationToken = default)
    {
        store ??= DefaultStore();
        if (request.Op == "create-key")
        {
            await EnsureSshKeyAsync(store, cancellationToken: cancellationToken);
        }
        else if (request.Op == "save-password")
        {
            var (target, targetError) = ParseSshTarget(request.Host, request.User, request.Port);
            if (target is null)
                throw new InvalidOperationException(targetError ?? "That server failed.");
            if (string.IsNullOrEmpty(request.Password))
                throw new InvalidOperationException("Type the password.");
            await SaveSshPasswordAsync(target, request.Password, store);
        }
        else if (request.Op == "delete-password")
        {
            var passwords = await ReadPasswordsAsync(store);
            if (request.Target is not null)
                passwords.Remove(request.Target);
            await WritePasswordsAsync(store, passwords);
        }
        else if (request.Op == "forget-host")
        {
            var hosts = await ReadKnownHostsAsync(store);
            if (request.Host is not null)
                hosts.Remove(HostKeyName(Bracketed(request.Host)));
            await WriteKnownHostsAsync(store, hosts);
        }
        else if (request.Op != "list")
        {
            throw new InvalidOperationException("Unknown request.");
        }

        var known = await ReadKnownHostsAsync(store);
        return new DahliaSshSettingsPayload(
            await EnsureSshKeyAsync(store, create: false, cancellationToken: cancellationToken),
            Path.Combine(store.SshDirectory, "id_ed25519"),
            (await ReadPasswordsAsync(store)).Keys.OrderBy(name => name, StringComparer.Ordinal).ToList(),
            known
                .Select(entry => (Name: entry.Key, Print: FingerprintOf(KnownHostsKey(entry.Value))))
                .Where(entry => entry.Print is not null)
                .Select(entry => new DahliaSshKnownHostPayload(entry.Name, entry.Print!))
                .OrderBy(entry => entry.Host, StringComparer.Ordinal)
                .ToList(),
            store.CanEncrypt());
    }

    private static string Bracketed(string host)
    {
        // Settings passes "host:port"; the store keys "host:port" with a lower-cased host.
        var colon = host.LastIndexOf(':');
        return colon > 0 ? host : $"{host}:22";
    }

    private static string KnownHostsKey(string line)
    {
        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 3 ? parts[2] : string.Empty;
    }
}

/// <summary>Windows' DPAPI for the saved SSH passwords: encrypted at rest, per user.</summary>
internal static class DahliaWindowsDataProtection
{
    private const uint CryptProtectUiForbidden = 0x1;

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int cbData;
        public IntPtr pbData;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CryptProtectPrompt
    {
        public int cbSize;
        public int dwPromptFlags;
        public IntPtr hwndApp;
        public string? szPrompt;
    }

    public static bool IsAvailable()
    {
        if (!OperatingSystem.IsWindows())
            return false;
        try
        {
            var roundTrip = Protect("dahlia");
            return Unprotect(roundTrip) == "dahlia";
        }
        catch
        {
            return false;
        }
    }

    [SupportedOSPlatform("windows")]
    public static string Protect(string text)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        var input = ToBlob(bytes);
        var prompt = new CryptProtectPrompt { cbSize = Marshal.SizeOf<CryptProtectPrompt>() };
        DataBlob output = default;
        try
        {
            var entropy = new DataBlob();
            if (!CryptProtectData(ref input, null, ref entropy, IntPtr.Zero, ref prompt, CryptProtectUiForbidden, out output))
                throw new InvalidOperationException("This PC can't encrypt passwords, so none is saved.");
            var protectedBytes = new byte[output.cbData];
            Marshal.Copy(output.pbData, protectedBytes, 0, output.cbData);
            return Convert.ToBase64String(protectedBytes);
        }
        finally
        {
            FreeBlob(input);
            FreeOutput(output);
        }
    }

    [SupportedOSPlatform("windows")]
    public static string Unprotect(string data)
    {
        var bytes = Convert.FromBase64String(data);
        var input = ToBlob(bytes);
        var prompt = new CryptProtectPrompt { cbSize = Marshal.SizeOf<CryptProtectPrompt>() };
        DataBlob output = default;
        try
        {
            var entropy = new DataBlob();
            if (!CryptUnprotectData(ref input, null, ref entropy, IntPtr.Zero, ref prompt, CryptProtectUiForbidden, out output))
                throw new InvalidOperationException("The saved password couldn't be read.");
            var plain = new byte[output.cbData];
            Marshal.Copy(output.pbData, plain, 0, output.cbData);
            return Encoding.UTF8.GetString(plain);
        }
        finally
        {
            FreeBlob(input);
            FreeOutput(output);
        }
    }

    private static DataBlob ToBlob(byte[] bytes)
    {
        var blob = new DataBlob { cbData = bytes.Length, pbData = Marshal.AllocHGlobal(bytes.Length) };
        Marshal.Copy(bytes, 0, blob.pbData, bytes.Length);
        return blob;
    }

    private static void FreeBlob(DataBlob blob)
    {
        if (blob.pbData != IntPtr.Zero)
            Marshal.FreeHGlobal(blob.pbData);
    }

    private static void FreeOutput(DataBlob blob)
    {
        if (blob.pbData != IntPtr.Zero)
            LocalFree(blob.pbData);
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(
        ref DataBlob pDataIn,
        string? szDataDescr,
        ref DataBlob pOptionalEntropy,
        IntPtr pvReserved,
        ref CryptProtectPrompt pPromptStruct,
        uint dwFlags,
        out DataBlob pDataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(
        ref DataBlob pDataIn,
        string? ppszDataDescr,
        ref DataBlob pOptionalEntropy,
        IntPtr pvReserved,
        ref CryptProtectPrompt pPromptStruct,
        uint dwFlags,
        out DataBlob pDataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr handle);
}

/// <summary>Ends a process and what it started (nmap, ssh).</summary>
internal static class DahliaProcessTrees
{
    public static void Stop(Process child)
    {
        try
        {
            if (OperatingSystem.IsWindows() && child.Id != 0)
            {
                using var killer = Process.Start(new ProcessStartInfo
                {
                    FileName = "taskkill",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                });
                killer?.StartInfo.ArgumentList.Add("/pid");
                killer?.StartInfo.ArgumentList.Add(child.Id.ToString());
                killer?.StartInfo.ArgumentList.Add("/T");
                killer?.StartInfo.ArgumentList.Add("/F");
                killer?.Start();
                killer?.WaitForExit(5_000);
            }
            else if (!child.HasExited)
            {
                child.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            try
            {
                if (!child.HasExited)
                    child.Kill();
            }
            catch
            {
                // The process is gone or unkillable; the result says it timed out.
            }
        }
    }
}

internal static class DahliaSshService
{
    /// <summary>Answers <c>eventa:invoke:dahlia:ssh:run</c> and <c>eventa:invoke:dahlia:ssh-settings:get</c>.</summary>
    public static IDisposable Attach(IEventContext context, DahliaSshStore? store = null)
    {
        var ssh = context.RegisterInvokeHandler(
            DahliaEvents.RunSsh,
            (DahliaSshRequestPayload request, CancellationToken cancellationToken) =>
                DahliaSsh.RunAsync(request, store, cancellationToken));
        var settings = context.RegisterInvokeHandler(
            DahliaEvents.SshSettings,
            (DahliaSshSettingsRequestPayload request, CancellationToken cancellationToken) =>
                DahliaSsh.SettingsAsync(request, store, cancellationToken));
        return new DahliaSshRegistration(ssh, settings);
    }

    private sealed class DahliaSshRegistration : IDisposable
    {
        private readonly IDisposable _ssh;
        private readonly IDisposable _settings;
        private bool _disposed;

        public DahliaSshRegistration(IDisposable ssh, IDisposable settings)
        {
            _ssh = ssh;
            _settings = settings;
        }

        public void Dispose()
        {
            if (_disposed)
                return;
            _disposed = true;
            _ssh.Dispose();
            _settings.Dispose();
        }
    }
}

/// <summary>Source-generated JSON for the SSH password file.</summary>
[JsonSerializable(typeof(Dictionary<string, string>))]
internal sealed partial class DahliaSshJsonContext : JsonSerializerContext;
