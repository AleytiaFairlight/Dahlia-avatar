using System.Runtime.InteropServices;
using Eventa;

/// <summary>
/// Dahlia: what this PC knows about what its person is doing, for her PC
/// awareness (the renderer's dahlia-pc-awareness.ts): the window in front and
/// its program, how long the keyboard and mouse have been still, how full the
/// processor and the memory are. The renderer asks on
/// <c>eventa:invoke:dahlia:pc-state:get</c>; nothing is collected until it does.
///
/// Port of Electron's <c>src/main/dahlia-pc-state.ts</c>
/// (<c>createDahliaPcState</c>, <c>setupDahliaPcState</c>): the same payload,
/// the same processor share measured between two answers, and the same rule
/// that without the window helper the rest is still worth telling. Kirie has
/// no window helper, so the window in front and the sound/graphics readings
/// are empty here; a helper (dahlia-window-helper.cs) can supply them later
/// through <see cref="DahliaPcStateDeps"/>.
/// </summary>
internal sealed record DahliaForegroundAnswer(
    bool Ok,
    string? Process,
    string? Title,
    double? Gpu,
    double? Volume,
    bool? Muted);

internal sealed class DahliaPcStateDeps
{
    /// <summary>The window in front and its program. Not-ok where the PC can't tell.</summary>
    public Func<Task<DahliaForegroundAnswer>> Foreground { get; set; } =
        () => Task.FromResult(new DahliaForegroundAnswer(false, null, null, null, null, null));

    /// <summary>The sound and the graphics card, from the window helper.</summary>
    public Func<Task<DahliaForegroundAnswer>>? System { get; set; }

    public Func<long> IdleSeconds { get; set; } = DahliaSystemCounters.IdleSeconds;
    public Func<bool> OwnFocused { get; set; } = () => false;

    /// <summary>Each processor's busy and total ticks, as node:os gives them.</summary>
    public Func<IReadOnlyList<(long Busy, long Total)>> CpuTimes { get; set; } = DahliaSystemCounters.CpuTimes;
    public Func<long> FreeMemory { get; set; } = DahliaSystemCounters.FreeMemory;
    public Func<long> TotalMemory { get; set; } = DahliaSystemCounters.TotalMemory;
}

/// <summary>
/// The PC's own counters. Windows reads the system times and memory status;
/// Linux reads /proc/stat and /proc/meminfo; elsewhere the readings stay
/// empty so the rest of the state is still worth telling.
/// </summary>
internal static class DahliaSystemCounters
{
    public static IReadOnlyList<(long Busy, long Total)> CpuTimes()
    {
        try
        {
            if (OperatingSystem.IsWindows() && WindowsCpuTimes() is { } windows)
            {
                return [windows];
            }

            if (OperatingSystem.IsLinux() && LinuxCpuTimes() is { } linux)
            {
                return [linux];
            }
        }
        catch
        {
            // A counter that can't be read leaves the processor share empty.
        }

        return [];
    }

    public static long FreeMemory()
    {
        try
        {
            if (OperatingSystem.IsWindows() && WindowsMemoryStatus() is { } windows)
            {
                return (long)windows.Available;
            }

            if (OperatingSystem.IsLinux() && LinuxMemInfo("MemAvailable") is { } available)
            {
                return available;
            }
        }
        catch
        {
            // Fall through to zero; the memory share then reads 0.
        }

        return 0;
    }

    public static long TotalMemory()
    {
        try
        {
            if (OperatingSystem.IsWindows() && WindowsMemoryStatus() is { } windows)
            {
                return (long)windows.Total;
            }

            if (OperatingSystem.IsLinux() && LinuxMemInfo("MemTotal") is { } total)
            {
                return total;
            }
        }
        catch
        {
            // Fall through to zero.
        }

        return 0;
    }

    public static long IdleSeconds()
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
                if (GetLastInputInfo(ref info))
                {
                    return Math.Max(0, (long)((GetTickCount64() - info.dwTime) / 1000));
                }
            }
        }
        catch
        {
            // No idle reading on this PC.
        }

        return 0;
    }

    private static (long Busy, long Total)? WindowsCpuTimes()
    {
        if (!GetSystemTimes(out var idle, out var kernel, out var user))
        {
            return null;
        }

        var idleTicks = FileTimeToLong(idle);
        // Kernel time holds idle time; the busy share is what is left.
        var total = FileTimeToLong(kernel) + FileTimeToLong(user);
        return (total - idleTicks, total);
    }

    private static (ulong Total, ulong Available)? WindowsMemoryStatus()
    {
        var status = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
        if (!GlobalMemoryStatusEx(ref status))
        {
            return null;
        }

        return (status.ullTotalPhys, status.ullAvailPhys);
    }

    private static (long Busy, long Total)? LinuxCpuTimes()
    {
        foreach (var line in File.ReadLines("/proc/stat"))
        {
            if (!line.StartsWith("cpu ", StringComparison.Ordinal))
            {
                continue;
            }

            var fields = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (fields.Length < 8 || !fields.Skip(1).Take(7).All(field => long.TryParse(field, out _)))
            {
                return null;
            }

            var numbers = fields.Skip(1).Take(7).Select(long.Parse).ToArray();
            var busy = numbers[0] + numbers[1] + numbers[2] + numbers[5] + numbers[6];
            return (busy, busy + numbers[3] + numbers[4]);
        }

        return null;
    }

    private static long? LinuxMemInfo(string key)
    {
        foreach (var line in File.ReadLines("/proc/meminfo"))
        {
            var parts = line.Split(':');
            if (parts.Length != 2 || !parts[0].Trim().Equals(key, StringComparison.Ordinal))
            {
                continue;
            }

            var value = parts[1].Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (value.Length > 0 && long.TryParse(value[0], out var kilobytes))
            {
                return kilobytes * 1024;
            }
        }

        return null;
    }

    private static long FileTimeToLong(FILETIME time) => ((long)time.dwHighDateTime << 32) | time.dwLowDateTime;

    [DllImport("kernel32.dll")]
    private static extern bool GetSystemTimes(out FILETIME idleTime, out FILETIME kernelTime, out FILETIME userTime);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX buffer);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

    [DllImport("kernel32.dll")]
    private static extern ulong GetTickCount64();

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }
}

internal sealed class DahliaPcStateReporter
{
    private (long Busy, long Total)? _before;
    private readonly DahliaPcStateDeps _deps;

    public DahliaPcStateReporter(DahliaPcStateDeps deps)
    {
        _deps = deps;
    }

    /// <summary>
    /// Answers with the PC's state; the processor's share is measured between
    /// two answers.
    /// </summary>
    public async Task<DahliaPcStatePayload> GetStateAsync()
    {
        // Without the window helper (or where it failed) the rest is still worth telling.
        var front = await TryGetAsync(_deps.Foreground);
        var system = _deps.System is null
            ? new DahliaForegroundAnswer(false, null, null, null, null, null)
            : await TryGetAsync(_deps.System);
        var total = _deps.TotalMemory();
        return new DahliaPcStatePayload(
            front.Ok && front.Process is string process ? process : string.Empty,
            front.Ok && front.Title is string title ? title : string.Empty,
            _deps.OwnFocused(),
            Math.Max(0, _deps.IdleSeconds()),
            CpuShare(),
            total > 0 ? (int)Math.Round((1 - (double)_deps.FreeMemory() / total) * 100) : 0,
            system.Ok ? Percent(system.Gpu) : null,
            system.Ok ? Percent(system.Volume) : null,
            system.Ok && system.Muted is bool muted ? muted : null);
    }

    private static int? Percent(double? value) =>
        value is double finite && double.IsFinite(finite)
            ? (int)Math.Round(Math.Min(100, Math.Max(0, finite)))
            : null;

    private int? CpuShare()
    {
        long busy = 0;
        long total = 0;
        foreach (var times in _deps.CpuTimes())
        {
            busy += times.Busy;
            total += times.Total;
        }

        var last = _before;
        _before = (busy, total);
        if (last is not { } before || total <= before.Total)
        {
            return null;
        }

        return (int)Math.Round(Math.Min(1, Math.Max(0, (double)(busy - before.Busy) / (total - before.Total))) * 100);
    }

    private static async Task<DahliaForegroundAnswer> TryGetAsync(Func<Task<DahliaForegroundAnswer>> read)
    {
        try
        {
            return await read();
        }
        catch
        {
            return new DahliaForegroundAnswer(false, null, null, null, null, null);
        }
    }
}

internal static class DahliaPcStateService
{
    public static IDisposable Attach(IEventContext context, DahliaPcStateDeps? deps = null)
    {
        var reporter = new DahliaPcStateReporter(deps ?? new DahliaPcStateDeps());
        return context.RegisterInvokeHandler(
            DahliaEvents.GetPcState,
            (EmptyPayload _, CancellationToken _) => reporter.GetStateAsync());
    }
}
