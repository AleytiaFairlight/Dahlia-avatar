using System.Runtime.Versioning;
using ScreenRecorderLib;

/// <summary>
/// Dahlia's screen recorder backend: ScreenRecorderLib 7.0.1, the OBS method (native
/// Microsoft Media Foundation for realtime H.264, DXGI desktop duplication for screens
/// and Windows Graphics Capture for windows, which sees GPU-drawn games and windows
/// behind others). Windows only, and x64 only like the Godot export
/// (export_presets.cfg is x86_64): the package injects its native DLL per platform,
/// so this project builds with -p:Platform=x64.
/// </summary>
internal interface IDahliaScreenRecording : IDisposable
{
    void Stop();
    Task<string> WaitForFileAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Starts host recordings. A seam so the capture service's op routing (single-recording
/// guard, window/screen resolution, saving) runs in tests without Windows or an encoder.
/// </summary>
internal interface IDahliaScreenRecorderFactory
{
    int DisplayCount { get; }
    IDahliaScreenRecording StartWindowRecording(long hwnd, string outputPath);
    IDahliaScreenRecording StartMainDisplayRecording(string outputPath);
    IDahliaScreenRecording StartDisplayRecording(int index, string outputPath);
}

/// <summary>The ScreenRecorderLib backend. Construct it only on Windows.</summary>
[SupportedOSPlatform("windows")]
internal sealed class ScreenRecorderLibRecorderFactory : IDahliaScreenRecorderFactory
{
    public int DisplayCount => Recorder.GetDisplays().Count;

    public IDahliaScreenRecording StartWindowRecording(long hwnd, string outputPath)
    {
        // Windows Graphics Capture is the library's window path, the same capture
        // Electron's Chromium desktop capturer used for windows.
        return Start(new WindowRecordingSource((IntPtr)hwnd), outputPath);
    }

    public IDahliaScreenRecording StartMainDisplayRecording(string outputPath)
    {
        return Start(NewDisplaySource(DisplayRecordingSource.MainMonitor.DeviceName), outputPath);
    }

    public IDahliaScreenRecording StartDisplayRecording(int index, string outputPath)
    {
        var displays = Recorder.GetDisplays();
        return Start(NewDisplaySource(displays[index].DeviceName), outputPath);
    }

    private static DisplayRecordingSource NewDisplaySource(string deviceName)
    {
        // DXGI desktop duplication, the OBS path Electron used for screens. A fresh
        // source per recording: MainMonitor is a shared instance, never mutate it.
        return new DisplayRecordingSource(deviceName) { RecorderApi = RecorderApi.DesktopDuplication };
    }

    private static IDahliaScreenRecording Start(RecordingSourceBase source, string outputPath)
    {
        var options = new RecorderOptions
        {
            SourceOptions = new SourceOptions { RecordingSources = new List<RecordingSourceBase> { source } },
            OutputOptions = new OutputOptions { RecorderMode = RecorderMode.Video },
            AudioOptions = new AudioOptions { IsAudioEnabled = false },
            VideoEncoderOptions = new VideoEncoderOptions
            {
                Bitrate = DahliaScreenCaptureService.RecordingBitsPerSecond,
                Framerate = DahliaScreenCaptureService.RecordingFps,
                IsFixedFramerate = true,
                Encoder = new H264VideoEncoder
                {
                    BitrateMode = H264BitrateControlMode.CBR,
                    EncoderProfile = H264Profile.Main,
                },
                IsHardwareEncodingEnabled = true,
            },
        };
        var recording = new ScreenRecorderLibRecording(Recorder.CreateRecorder(options));
        recording.Record(outputPath);
        return recording;
    }
}

/// <summary>
/// One ScreenRecorderLib recording. Completion and failure arrive on events; the
/// service awaits them through <see cref="WaitForFileAsync"/>.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class ScreenRecorderLibRecording : IDahliaScreenRecording
{
    private readonly Recorder _recorder;
    private readonly TaskCompletionSource<string> _done = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool _disposed;

    public ScreenRecorderLibRecording(Recorder recorder)
    {
        _recorder = recorder;
        _recorder.OnRecordingComplete += (_, args) => _done.TrySetResult(args.FilePath ?? string.Empty);
        _recorder.OnRecordingFailed += (_, args) => _done.TrySetException(
            new InvalidOperationException(string.IsNullOrWhiteSpace(args.Error) ? "The recording failed." : args.Error));
    }

    public void Record(string outputPath) => _recorder.Record(outputPath);

    public void Stop()
    {
        if (!_disposed)
            _recorder.Stop();
    }

    public Task<string> WaitForFileAsync(CancellationToken cancellationToken) => _done.Task.WaitAsync(cancellationToken);

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _done.TrySetCanceled();
        _recorder.Dispose();
    }
}
