using System.Threading;

/// <summary>
/// Dahlia: the single-instance handshake with the installer. The host holds this named mutex
/// while it runs; the Inno Setup installer waits on the same name (installer.iss AppMutex),
/// so a silent update install never races the running host for its own files. The names must
/// stay identical on both sides.
/// </summary>
internal sealed class DahliaAppMutex : IDisposable
{
    public const string MutexName = "DahliaKirieApp";

    public static bool IsSupported => OperatingSystem.IsWindows();

    private Mutex? _mutex;
    private bool _owned;
    private bool _disposed;

    private DahliaAppMutex(Mutex? mutex, bool owned)
    {
        _mutex = mutex;
        _owned = owned;
    }

    /// <summary>
    /// Holds the app mutex for the host's lifetime, or null where named
    /// mutexes are unavailable (non-Windows). Never throws.
    /// </summary>
    public static DahliaAppMutex? Acquire()
    {
        if (!IsSupported)
        {
            return null;
        }

        try
        {
            var mutex = new Mutex(true, MutexName, out var createdNew);
            return new DahliaAppMutex(mutex, createdNew);
        }
        catch (AbandonedMutexException abandoned)
        {
            // The previous holder died without releasing: ownership passes to us.
            var mutex = abandoned.Mutex;
            return new DahliaAppMutex(mutex, mutex is not null);
        }
        catch
        {
            return null;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_owned)
        {
            try
            {
                _mutex?.ReleaseMutex();
            }
            catch
            {
                // Already released or never owned: shutting down matters more.
            }
        }

        _mutex?.Dispose();
        _mutex = null;
    }
}
