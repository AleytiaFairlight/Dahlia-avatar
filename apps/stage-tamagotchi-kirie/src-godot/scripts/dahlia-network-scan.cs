using System.Diagnostics;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using Eventa;

/// <summary>
/// Dahlia's local network scans for her other devices (her
/// <c>network_scan</c> tool), on
/// <c>eventa:invoke:dahlia:network-scan:run</c>.
///
/// Port of Electron's <c>src/main/dahlia-network-scan.ts</c>
/// (<c>scanArguments</c>, <c>findNmap</c>, <c>parsePortList</c>,
/// <c>expandTargetHosts</c>, <c>tcpProbe</c>/<c>builtInScan</c>,
/// <c>isAgentHeavyScan</c>, <c>runDahliaNetworkScan</c>): the same target and
/// port validation, the same light/heavy split, the same built-in full-TCP
/// prober (no nmap, no admin), and the same nmap flags for light scans.
///
/// Difference from Electron: heavy scans (vuln/intrusive/exploit NSE,
/// syn/syn-fin/syn-rst) ran on the Dahlia Agent via MCP from the Electron
/// host. The Kirie host has no MCP client yet (deferred, like the files-MCP
/// sidecar), so heavy scans are refused with where to run them instead of
/// being routed. The refusal text matches Electron's no-agent message.
/// </summary>
internal static class DahliaNetworkScan
{
    public const int MaxOutput = 24_000;
    public const int DefaultTimeoutMs = 180_000;
    public const int MaxTimeoutMs = 900_000;

    /// <summary>Built-in TCP fallback (no nmap needed): per-port timeout, host/port caps.</summary>
    public const int BuiltInProbeTimeoutMs = 1_500;
    public const int BuiltInMaxHosts = 256;
    public const int BuiltInMaxPorts = 1_000;

    public static readonly IReadOnlyList<int> BuiltInTopPorts =
        new List<int> { 21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 1723, 3306, 3389, 5900, 8080, 8443 };

    public static readonly IReadOnlyList<int> BuiltInDiscoveryPorts = new List<int> { 80, 443, 22, 445 };

    public static readonly IReadOnlyDictionary<int, string> BuiltInServiceNames = new Dictionary<int, string>
    {
        [21] = "ftp",
        [22] = "ssh",
        [23] = "telnet",
        [25] = "smtp",
        [53] = "domain",
        [80] = "http",
        [110] = "pop3",
        [135] = "msrpc",
        [139] = "netbios-ssn",
        [143] = "imap",
        [443] = "https",
        [445] = "microsoft-ds",
        [993] = "imaps",
        [995] = "pop3s",
        [1723] = "pptp",
        [3306] = "mysql",
        [3389] = "ms-wbt-server",
        [5900] = "vnc",
        [8080] = "http-proxy",
        [8443] = "https-alt",
    };

    /// <summary>A target nmap may be pointed at: a host name, IPv4 (optionally /CIDR), or a dash range. Never a flag.</summary>
    private static readonly Regex TargetPattern = new("^(?!-)[a-z0-9.\\-/]{1,64}$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Ports as nmap's -p takes them: numbers, commas and dashes.</summary>
    private static readonly Regex PortsPattern = new("^[0-9,\\-]{1,64}$", RegexOptions.Compiled);

    /// <summary>Whether the scan belongs on the Dahlia Agent (heavy NSE or raw-packet probes).</summary>
    public static bool IsHeavyScan(string? scanType, string? connectType)
    {
        var type = string.IsNullOrEmpty(scanType) ? "ports" : scanType;
        var connect = string.IsNullOrEmpty(connectType) ? "full" : connectType;
        return type is "vuln" or "intrusive" or "exploit" || connect is not "full";
    }

    /// <summary>The nmap flags for LIGHT scans only. Heavy scans are refused with where to run them.</summary>
    public static (string[]? Args, string? Error) ScanArguments(DahliaNetworkScanRequestPayload request)
    {
        var target = request.Target?.Trim() ?? string.Empty;
        if (!TargetPattern.IsMatch(target))
            return (null, "The target must be a host name, an IP address, a CIDR block, or a dash range (for example 192.168.10.0/24).");
        if (request.Ports is not null && !PortsPattern.IsMatch(request.Ports.Trim()))
            return (null, "The ports must be numbers, commas and dashes, as nmap's -p takes them (for example 22,80,443).");
        var connectType = request.ConnectType ?? "full";
        if (connectType is not ("full" or "syn" or "syn-fin" or "syn-rst"))
            return (null, "Unknown connect type. Use full, syn, syn-fin or syn-rst.");
        if (IsHeavyScan(request.ScanType, request.ConnectType))
            return (null, "Heavy scans (vuln/intrusive/exploit, syn/syn-fin/syn-rst) moved to the Dahlia Agent: Dahlia runs them via MCP network_scan on the Agent, not locally. Light discovery/ports/service (full connect) stay local for SSH and network tasks.");

        // -oN - writes the normal report to stdout; -T4 caps the speed; --host-timeout keeps one slow host from hanging the scan.
        string[] common = ["-T4", "--host-timeout", "120s", "-oN", "-"];
        var ports = string.IsNullOrWhiteSpace(request.Ports) ? Array.Empty<string>() : new[] { "-p", request.Ports.Trim() };
        return (request.ScanType ?? "ports") switch
        {
            "discovery" => (["-sn", .. common, target], null),
            "ports" => (["-sT", "-Pn", .. ports, .. common, target], null),
            "service" => (["-sT", "-sV", "-Pn", .. ports, .. common, target], null),
            _ => ((string[]?)null, "Unknown scan type. Use discovery, ports or service locally. vuln/intrusive/exploit moved to the Dahlia Agent via MCP network_scan."),
        };
    }

    /// <summary>The nmap executable on PATH, or at its usual Windows install path, or null when it isn't installed.</summary>
    public static string? FindNmap()
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        var names = OperatingSystem.IsWindows() ? new[] { "nmap.exe" } : new[] { "nmap" };
        foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var name in names)
            {
                try
                {
                    var candidate = Path.Combine(dir.Trim(), name);
                    if (File.Exists(candidate))
                        return candidate;
                }
                catch
                {
                    // An unreadable PATH entry is not a scanner.
                }
            }
        }
        if (OperatingSystem.IsWindows())
        {
            string[] fixedPaths =
            [
                "C:\\Program Files (x86)\\Nmap\\nmap.exe",
                "C:\\Program Files\\Nmap\\nmap.exe",
            ];
            foreach (var candidate in fixedPaths)
            {
                try
                {
                    if (File.Exists(candidate))
                        return candidate;
                }
                catch
                {
                    // A missing drive is not a scanner.
                }
            }
            return null;
        }
        string[] unixPaths = ["/usr/bin/nmap", "/usr/local/bin/nmap", "/opt/homebrew/bin/nmap"];
        return unixPaths.FirstOrDefault(File.Exists);
    }

    /// <summary>"22,80-82" -&gt; [22,80,81,82]. Empty/unset -&gt; built-in top ports. Throws on bad input or &gt;1000 ports.</summary>
    public static List<int> ParsePortList(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
            return new List<int>(BuiltInTopPorts);
        var ports = new SortedSet<int>();
        foreach (var part in input.Split(','))
        {
            var text = part.Trim();
            if (text.Length == 0)
                continue;
            var dash = text.IndexOf('-');
            if (dash < 0)
            {
                if (!int.TryParse(text, out var port) || port < 1 || port > 65535)
                    throw new InvalidOperationException($"Bad port \"{text}\".");
                ports.Add(port);
            }
            else
            {
                if (!int.TryParse(text[..dash], out var start) || !int.TryParse(text[(dash + 1)..], out var end)
                    || start < 1 || end > 65535 || end < start || end - start > BuiltInMaxPorts)
                    throw new InvalidOperationException($"Bad port range \"{text}\".");
                for (var port = start; port <= end; port++)
                    ports.Add(port);
            }
            if (ports.Count > BuiltInMaxPorts)
                throw new InvalidOperationException($"Too many ports (at most {BuiltInMaxPorts}).");
        }
        return ports.Count > 0 ? new List<int>(ports) : new List<int>(BuiltInTopPorts);
    }

    private static uint? Ipv4ToInt(string ip)
    {
        var parts = ip.Split('.');
        if (parts.Length != 4)
            return null;
        uint value = 0;
        foreach (var part in parts)
        {
            if (part.Length is 0 or > 3 || !part.All(char.IsAsciiDigit))
                return null;
            if (!byte.TryParse(part, out var octet))
                return null;
            value = value * 256 + octet;
        }
        return value;
    }

    private static string IntToIpv4(uint value) =>
        $"{(value >> 24) & 255}.{(value >> 16) & 255}.{(value >> 8) & 255}.{value & 255}";

    /// <summary>Expands one target into concrete hosts: single host/IP, CIDR (/16 to /32, capped), or last-octet dash range.</summary>
    public static (List<string>? Hosts, string? Error) ExpandTargetHosts(string? target)
    {
        var text = target?.Trim() ?? string.Empty;
        var slash = text.IndexOf('/');
        if (slash > 0)
        {
            var baseAddress = Ipv4ToInt(text[..slash]);
            if (baseAddress is null || !int.TryParse(text[(slash + 1)..], out var prefix) || prefix < 16 || prefix > 32)
                return (null, "The CIDR block must be IPv4 /16 to /32 (for example 192.168.10.0/24).");
            var count = 1L << (32 - prefix);
            if (count > BuiltInMaxHosts + 2)
                return (null, $"That block has {count} addresses; narrow it to {BuiltInMaxHosts} hosts or fewer (for example a /24).");
            var mask = prefix == 0 ? 0u : 0xFFFFFFFFu << (32 - prefix);
            var network = baseAddress.Value & mask;
            // Skip network/broadcast for prefixes smaller than /31, like nmap does.
            var first = count <= 2 ? network : network + 1;
            var last = count <= 2 ? network + (uint)count - 1 : network + (uint)count - 2;
            var hosts = new List<string>();
            for (var ip = first; ip <= last && hosts.Count < BuiltInMaxHosts; ip++)
                hosts.Add(IntToIpv4(ip));
            return hosts.Count > 0 ? (hosts, null) : (null, "That block has no usable hosts.");
        }
        var dash = text.LastIndexOf('-');
        var dot = text.LastIndexOf('.');
        if (dash > dot && dot > 0)
        {
            var prefixText = text[..(dot + 1)];
            if (Ipv4ToInt($"{prefixText}0") is null
                || !int.TryParse(text[(dot + 1)..dash], out var start)
                || !int.TryParse(text[(dash + 1)..], out var end)
                || start < 0 || end > 255 || end < start || end - start + 1 > BuiltInMaxHosts)
                return (null, $"The range must be like 192.168.10.1-254 with at most {BuiltInMaxHosts} hosts.");
            var hosts = new List<string>();
            for (var octet = start; octet <= end; octet++)
                hosts.Add($"{prefixText}{octet}");
            return (hosts, null);
        }
        return (new List<string> { text }, null);
    }

    /// <summary>One TCP connect probe; resolves open + banner, never throws.</summary>
    public static async Task<(bool Open, string? Banner)> TcpProbeAsync(string host, int port, int timeoutMs = BuiltInProbeTimeoutMs)
    {
        using var timeout = new CancellationTokenSource(timeoutMs);
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(host, port, timeout.Token);
            var stream = client.GetStream();
            var buffer = new byte[1024];
            using var bannerTimeout = new CancellationTokenSource(800);
            try
            {
                var read = await stream.ReadAsync(buffer, bannerTimeout.Token);
                var banner = Encoding.UTF8.GetString(buffer, 0, read).Trim();
                return (true, banner.Length > 0 ? banner[..Math.Min(200, banner.Length)] : null);
            }
            catch (OperationCanceledException)
            {
                // No greeting within the banner window: the port is still open.
                return (true, null);
            }
        }
        catch
        {
            return (false, null);
        }
    }

    /// <summary>Built-in discovery/ports/service scan (no nmap): TCP connect only. Heavy scans never reach here.</summary>
    public static async Task<string> BuiltInScanAsync(
        IReadOnlyList<string> hosts,
        IReadOnlyList<int> ports,
        string scanType,
        int timeoutMs,
        Func<string, int, Task<(bool Open, string? Banner)>>? probe = null,
        CancellationToken cancellationToken = default)
    {
        probe ??= (host, port) => TcpProbeAsync(host, port);
        var deadline = DateTime.UtcNow + TimeSpan.FromMilliseconds(timeoutMs);
        var servicePorts = scanType == "discovery" ? BuiltInDiscoveryPorts : ports;
        var lines = new List<string>();

        async Task<List<int>> ProbeHostAsync(string host)
        {
            var open = new List<int>();
            var index = 0;
            var workers = Enumerable.Range(0, Math.Min(32, servicePorts.Count)).Select(async _ =>
            {
                while (DateTime.UtcNow < deadline && !cancellationToken.IsCancellationRequested)
                {
                    int port;
                    lock (servicePorts)
                    {
                        if (index >= servicePorts.Count)
                            return;
                        port = servicePorts[index++];
                    }
                    var result = await probe(host, port);
                    if (result.Open)
                    {
                        lock (open)
                            open.Add(port);
                        if (scanType == "discovery")
                        {
                            lock (servicePorts)
                                index = servicePorts.Count;
                            return;
                        }
                    }
                }
            });
            await Task.WhenAll(workers);
            open.Sort();
            return open;
        }

        var probed = new List<(string Host, List<int> Open)>();
        for (var i = 0; i < hosts.Count && DateTime.UtcNow < deadline && !cancellationToken.IsCancellationRequested; i += 16)
        {
            var chunk = hosts.Skip(i).Take(16).ToArray();
            var results = await Task.WhenAll(chunk.Select(async host => (host, await ProbeHostAsync(host))));
            probed.AddRange(results.Select(r => (r.host, r.Item2)));
        }

        foreach (var (host, open) in probed)
        {
            if (scanType == "discovery")
            {
                if (open.Count > 0)
                    lines.Add($"Nmap scan report for {host}\nHost is up (built-in TCP probe, port {open[0]} open).");
            }
            else if (open.Count == 0)
            {
                lines.Add($"Nmap scan report for {host}\nHost is up but no scanned ports are open (built-in TCP connect).");
            }
            else
            {
                lines.Add($"Nmap scan report for {host}\nHost is up (built-in TCP probe).\nPORT    STATE SERVICE");
                foreach (var port in open)
                    lines.Add($"{port}/tcp  open  {(BuiltInServiceNames.TryGetValue(port, out var name) ? name : "unknown")}");
            }
        }
        if (lines.Count == 0)
            return "(no output)";
        return $"{string.Join('\n', lines)}\n[built-in scanner: nmap not installed, TCP connect only; install nmap for versions and vuln scripts]";
    }

    /// <summary>
    /// Runs the scan: nmap when installed, else the built-in TCP connect
    /// scanner for discovery/ports/service. Heavy scans are refused with where
    /// to run them. Never throws: a failure is the result.
    /// </summary>
    public static async Task<DahliaNetworkScanResultPayload> RunAsync(
        DahliaNetworkScanRequestPayload request,
        Func<string?>? findNmap = null,
        Func<string, int, Task<(bool Open, string? Banner)>>? probe = null,
        CancellationToken cancellationToken = default)
    {
        var timeoutMs = Math.Min(
            MaxTimeoutMs,
            Math.Max(5_000, (int)((request.TimeoutSeconds is double seconds && seconds > 0 ? seconds : DefaultTimeoutMs / 1000.0) * 1000)));

        if (IsHeavyScan(request.ScanType, request.ConnectType))
        {
            return new DahliaNetworkScanResultPayload(
                false, null,
                "Heavy scans (vuln/intrusive/exploit, syn/syn-fin/syn-rst) moved to the Dahlia Agent: Dahlia runs them via MCP network_scan on the Agent, not locally. Configure DAHLIA_AGENT_MCP_URL.",
                false);
        }

        var (args, validationError) = ScanArguments(request);
        if (args is null)
            return new DahliaNetworkScanResultPayload(false, null, validationError ?? "That scan failed.", false);

        var nmap = (findNmap ?? FindNmap)();
        if (nmap is null)
        {
            var scanType = request.ScanType ?? "ports";
            var (hosts, hostsError) = ExpandTargetHosts(request.Target);
            if (hosts is null)
                return new DahliaNetworkScanResultPayload(false, null, hostsError ?? "That target failed.", false);
            List<int> ports;
            try
            {
                ports = scanType == "discovery" ? new List<int>(BuiltInDiscoveryPorts) : ParsePortList(request.Ports);
            }
            catch (InvalidOperationException error)
            {
                return new DahliaNetworkScanResultPayload(false, null, error.Message, false);
            }
            var startedAt = DateTime.UtcNow;
            var output = await BuiltInScanAsync(hosts, ports, scanType, timeoutMs, probe, cancellationToken);
            var clipped = Clip(output);
            var timedOut = DateTime.UtcNow - startedAt >= TimeSpan.FromMilliseconds(timeoutMs);
            return new DahliaNetworkScanResultPayload(
                !timedOut, 0,
                timedOut ? $"{clipped}\n[stopped after {Math.Round(timeoutMs / 1000.0)} seconds]" : clipped,
                timedOut);
        }

        return await RunNmapAsync(nmap, args, timeoutMs, cancellationToken);
    }

    private static async Task<DahliaNetworkScanResultPayload> RunNmapAsync(
        string nmap, string[] args, int timeoutMs, CancellationToken cancellationToken)
    {
        Process? child;
        try
        {
            child = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = nmap,
                    WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                },
            };
            foreach (var argument in args)
                child.StartInfo.ArgumentList.Add(argument);
            child.Start();
        }
        catch (Exception error)
        {
            return new DahliaNetworkScanResultPayload(false, null, $"nmap couldn't start: {error.Message}", false);
        }

        using (child)
        {
            var output = new StringBuilder();
            var cut = false;
            void Add(string? chunk)
            {
                if (cut || chunk is null)
                    return;
                output.Append(chunk);
                if (output.Length > MaxOutput)
                {
                    output.Length = MaxOutput;
                    cut = true;
                }
            }
            child.OutputDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data is not null)
                    Add(eventArgs.Data + "\n");
            };
            child.ErrorDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data is not null)
                    Add(eventArgs.Data + "\n");
            };
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();

            var timedOut = false;
            try
            {
                using var timeout = new CancellationTokenSource(timeoutMs);
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
                await child.WaitForExitAsync(linked.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                timedOut = true;
                StopTree(child);
            }

            if (!timedOut)
            {
                try
                {
                    await child.WaitForExitAsync(cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    timedOut = true;
                    StopTree(child);
                    await child.WaitForExitAsync(CancellationToken.None);
                }
            }
            else
            {
                try
                {
                    await child.WaitForExitAsync(CancellationToken.None);
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
                    exitCode = child.HasExited ? child.ExitCode : null;
                }
                catch
                {
                    exitCode = null;
                }
            }

            var text = output.ToString().TrimEnd();
            if (cut)
                text += "\n[cut: the report was longer]";
            if (timedOut)
                text += $"\n[stopped after {Math.Round(timeoutMs / 1000.0)} seconds]";
            return new DahliaNetworkScanResultPayload(
                !timedOut && exitCode == 0, exitCode,
                text.Length > 0 ? text : "(no output)", timedOut);
        }
    }

    internal static string Clip(string output) =>
        output.Length > MaxOutput ? $"{output[..MaxOutput]}\n[cut: the report was longer]" : output;

    /// <summary>Ends nmap and what it started.</summary>
    private static void StopTree(Process child)
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
                // The process is gone or unkillable; the result below says it timed out.
            }
        }
    }
}

internal static class DahliaNetworkScanService
{
    /// <summary>Answers <c>eventa:invoke:dahlia:network-scan:run</c> requests on every platform.</summary>
    public static IDisposable Attach(IEventContext context)
    {
        return context.RegisterInvokeHandler(
            DahliaEvents.RunNetworkScan,
            (DahliaNetworkScanRequestPayload request, CancellationToken cancellationToken) =>
                DahliaNetworkScan.RunAsync(request, cancellationToken: cancellationToken));
    }
}
