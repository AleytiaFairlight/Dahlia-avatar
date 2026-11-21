using System.Net;
using Eventa;

/// <summary>
/// Dahlia: tells the windows the PC's host name, the name Dahlia's other
/// devices see for this PC unless one is set in Settings > Dahlia
/// (stage-ui <c>libs/dahlia-device-name.ts</c>).
///
/// Port of Electron's <c>src/main/dahlia-device.ts</c>
/// (<c>setupDahliaDevice</c>, the <c>dahlia:host-name</c> channel), answered
/// here on <c>eventa:invoke:dahlia:host-name:get</c>. Unlike PowerShell this
/// runs on every platform.
/// </summary>
internal static class DahliaDeviceService
{
    public static IDisposable Attach(IEventContext context)
    {
        return context.RegisterInvokeHandler(
            DahliaEvents.GetHostName,
            (EmptyPayload _, CancellationToken _) => Task.FromResult(HostName()));
    }

    private static string HostName()
    {
        try
        {
            return Dns.GetHostName();
        }
        catch
        {
            return Environment.MachineName;
        }
    }
}
