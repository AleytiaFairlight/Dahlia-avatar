/// <summary>
/// Dahlia's window recovery: a stopped page stays blank until the app
/// restarts, and the main window holds Dahlia's chat and her tools, so the
/// page is reloaded. <see cref="MaxReloads"/> in <see cref="ReloadWindowMs"/>
/// keeps a broken page from looping.
///
/// Port of Electron's <c>src/main/dahlia-window-recovery.ts</c>
/// (<c>shouldReloadPage</c>, <c>setupDahliaWindowRecovery</c>): the same
/// reload budget. Electron watches the <c>render-process-gone</c> event;
/// Kirie's webview host exposes no crash signal yet, so the tracker below
/// stands ready for one: <see cref="DahliaWindowRecoveryTracker.NoteStopped"/>
/// decides, and the caller reloads after <see cref="ReloadDelayMs"/>.
/// </summary>
internal static class DahliaWindowRecovery
{
    public const int MaxReloads = 3;
    public const long ReloadWindowMs = 5 * 60_000;
    public const int ReloadDelayMs = 1_000;

    /// <summary>
    /// Decides whether a page that stopped is reloaded.
    ///
    /// Expects:
    /// - <paramref name="reason"/> is Electron's <c>render-process-gone</c> reason
    /// - <paramref name="history"/> holds the times of this window's earlier
    /// reloads, oldest first, and is updated in place
    ///
    /// Returns:
    /// - true when the page should be reloaded now
    /// </summary>
    public static bool ShouldReloadPage(string reason, List<long> history, long nowMs, bool quitting)
    {
        // A clean exit is the page closing on purpose, and while the app quits every page goes.
        if (quitting || reason == "clean-exit")
        {
            return false;
        }

        while (history.Count > 0 && nowMs - history[0] > ReloadWindowMs)
        {
            history.RemoveAt(0);
        }

        if (history.Count >= MaxReloads)
        {
            return false;
        }

        history.Add(nowMs);
        return true;
    }
}

internal sealed class DahliaWindowRecoveryTracker
{
    private readonly Dictionary<string, List<long>> _histories = new(StringComparer.Ordinal);

    /// <summary>
    /// Records that a window's page stopped and says whether the caller
    /// should reload it after <see cref="DahliaWindowRecovery.ReloadDelayMs"/>.
    /// </summary>
    public bool NoteStopped(string windowKey, string reason, long nowMs, bool quitting)
    {
        if (!_histories.TryGetValue(windowKey, out var history))
        {
            history = [];
            _histories[windowKey] = history;
        }

        return DahliaWindowRecovery.ShouldReloadPage(reason, history, nowMs, quitting);
    }
}
