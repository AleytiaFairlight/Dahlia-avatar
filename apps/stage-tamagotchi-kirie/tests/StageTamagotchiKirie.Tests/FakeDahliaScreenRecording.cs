/// <summary>Dahlia: fakes for the screen recording op routing tests: a recorder that
/// writes a few bytes instead of encoding, with scripted failures.</summary>
internal sealed class FakeDahliaScreenRecording : IDahliaScreenRecording
{
    private readonly string _outputPath;
    private readonly string? _failure;

    public bool Stopped { get; private set; }

    public bool Disposed { get; private set; }

    public FakeDahliaScreenRecording(string outputPath, string? failure = null)
    {
        _outputPath = outputPath;
        _failure = failure;
    }

    public void Stop()
    {
        Stopped = true;
        if (_failure is null)
            File.WriteAllBytes(_outputPath, [1, 2, 3, 4]);
    }

    public Task<string> WaitForFileAsync(CancellationToken cancellationToken)
    {
        return _failure is null
            ? Task.FromResult(_outputPath)
            : Task.FromException<string>(new InvalidOperationException(_failure));
    }

    public void Dispose()
    {
        Disposed = true;
    }
}

internal sealed class FakeDahliaScreenRecorderFactory : IDahliaScreenRecorderFactory
{
    public int DisplayCount { get; set; } = 2;

    public string? Failure { get; set; }

    public List<string> Started { get; } = new();

    public IDahliaScreenRecording StartWindowRecording(long hwnd, string outputPath)
    {
        Started.Add($"window:{hwnd}");
        return new FakeDahliaScreenRecording(outputPath, Failure);
    }

    public IDahliaScreenRecording StartMainDisplayRecording(string outputPath)
    {
        Started.Add("main");
        return new FakeDahliaScreenRecording(outputPath, Failure);
    }

    public IDahliaScreenRecording StartDisplayRecording(int index, string outputPath)
    {
        Started.Add($"display:{index}");
        return new FakeDahliaScreenRecording(outputPath, Failure);
    }
}

internal sealed class NoopDahliaRegistration : IDisposable
{
    public void Dispose()
    {
    }
}
