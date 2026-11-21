/// <summary>Dahlia: a scripted update source for the auto-update schedule tests.</summary>
internal sealed class FakeDahliaUpdateSource : IDahliaUpdateSource
{
    public DahliaUpdateStatus Status { get; private set; }

    public DahliaUpdateInfo? Info { get; private set; }

    public event Action? StateChanged;

    public int CheckCalls { get; private set; }

    public int DownloadCalls { get; private set; }

    public int InstallCalls { get; private set; }

    public FakeDahliaUpdateSource(DahliaUpdateStatus status = DahliaUpdateStatus.Idle)
    {
        Status = status;
    }

    public void Emit(DahliaUpdateStatus status, DahliaUpdateInfo? info = null)
    {
        Status = status;
        Info = info;
        StateChanged?.Invoke();
    }

    public Task CheckForUpdatesAsync()
    {
        CheckCalls++;
        return Task.CompletedTask;
    }

    public Task DownloadUpdateAsync()
    {
        DownloadCalls++;
        return Task.CompletedTask;
    }

    public Task QuitAndInstallAsync()
    {
        InstallCalls++;
        return Task.CompletedTask;
    }
}
