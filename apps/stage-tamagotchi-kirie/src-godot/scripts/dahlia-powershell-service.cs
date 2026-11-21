using System.Diagnostics;
using System.Text;
using Eventa;
using Godot;

/// <summary>
/// Dahlia's PowerShell tool for her other devices (the "powershell" tool of
/// the renderer's dahlia-remote-tools.ts), on
/// <c>eventa:invoke:dahlia:powershell:run</c>. Each command runs in a new
/// Windows PowerShell in the user's home folder, without a window, and
/// returns its output.
///
/// Port of Electron's <c>src/main/dahlia-powershell.ts</c>
/// (<c>powerShellArguments</c>, <c>runDahliaPowerShell</c>): the same
/// UTF-16LE Base64 encoding (so no quoting breaks the command), the same
/// 16,000-character cap, the same 1-300 s timeout, and the same Windows-only
/// answer elsewhere.
/// </summary>
internal static class DahliaPowerShellRunner
{
    public const int MaxOutput = 16_000;
    private const int DefaultTimeoutMs = 60_000;
    private const int MaxTimeoutMs = 300_000;

    /// <summary>
    /// The arguments of powershell.exe for a command: UTF-8 output, and the
    /// command encoded so no quoting breaks it.
    /// </summary>
    public static string[] BuildArguments(string command)
    {
        var script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$ProgressPreference = 'SilentlyContinue'\n" + command;
        return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(script))];
    }

    /// <summary>
    /// Runs a command and collects its output, cut at the limit, until it
    /// ends or the time is up. Never throws: a failure is the result.
    /// </summary>
    public static async Task<DahliaPowerShellResultPayload> RunAsync(
        DahliaPowerShellRequestPayload request,
        CancellationToken cancellationToken = default)
    {
        var command = request.Command?.Trim() ?? string.Empty;
        if (command.Length == 0)
        {
            return new DahliaPowerShellResultPayload(false, null, "No command was given.", false);
        }

        if (!OperatingSystem.IsWindows())
        {
            return new DahliaPowerShellResultPayload(false, null, "PowerShell runs only in the Windows app.", false);
        }

        var timeoutMs = Math.Min(
            MaxTimeoutMs,
            Math.Max(1_000, (int)((request.TimeoutSeconds is double seconds && seconds > 0 ? seconds : DefaultTimeoutMs / 1000.0) * 1000)));

        Process? child;
        try
        {
            child = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    WorkingDirectory = System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                },
            };
            foreach (var argument in BuildArguments(command))
            {
                child.StartInfo.ArgumentList.Add(argument);
            }

            child.Start();
        }
        catch (Exception error)
        {
            return new DahliaPowerShellResultPayload(false, null, $"PowerShell couldn't start: {error.Message}", false);
        }

        using (child)
        {
            var output = new StringBuilder();
            var cut = false;
            void Add(string? chunk)
            {
                if (cut || chunk is null)
                {
                    return;
                }

                output.Append(chunk);
                if (output.Length > MaxOutput)
                {
                    output.Length = MaxOutput;
                    cut = true;
                }
            }

            child.OutputDataReceived += (_, args) =>
            {
                if (args.Data is not null)
                {
                    Add(args.Data + "\n");
                }
            };
            child.ErrorDataReceived += (_, args) =>
            {
                if (args.Data is not null)
                {
                    Add(args.Data + "\n");
                }
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
            {
                text += "\n[cut: the output was longer]";
            }

            if (timedOut)
            {
                text += $"\n[stopped after {Math.Round(timeoutMs / 1000.0)} seconds]";
            }

            return new DahliaPowerShellResultPayload(
                !timedOut && exitCode == 0,
                exitCode,
                text.Length > 0 ? text : "(no output)",
                timedOut);
        }
    }

    /// <summary>Ends PowerShell and what it started.</summary>
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
                {
                    child.Kill();
                }
            }
            catch
            {
                // The process is gone or unkillable; the result below says it timed out.
            }
        }
    }
}

internal static class DahliaPowerShellService
{
    /// <summary>
    /// Answers <c>eventa:invoke:dahlia:powershell:run</c> requests: on
    /// Windows only.
    /// </summary>
    public static IDisposable Attach(IEventContext context)
    {
        return context.RegisterInvokeHandler(
            DahliaEvents.RunPowerShell,
            (DahliaPowerShellRequestPayload request, CancellationToken cancellationToken) =>
                DahliaPowerShellRunner.RunAsync(request, cancellationToken));
    }
}
