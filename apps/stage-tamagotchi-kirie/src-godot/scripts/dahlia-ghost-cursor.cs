using System.Text;
using Eventa;
using Godot;

/// <summary>
/// Dahlia's ghost cursor: when she backseats (her point_on_screen tool, the
/// renderer's dahlia-remote-tools.ts), a translucent pointer with a few words
/// of hers appears on the person's screen where she points, for a few seconds.
/// A small overlay window that the mouse goes through and that never takes the
/// focus, so the game keeps it.
///
/// Port of Electron's <c>src/main/dahlia-ghost-cursor.ts</c>
/// (<c>ghostCursorPage</c>, <c>setupDahliaGhostCursor</c>).
///
/// Differences from Electron: Electron showed the cursor in a transparent
/// BrowserWindow with a pulsing CSS ring. The Kirie host has no webview to
/// spare for this, so the overlay is a plain Godot window: a pink arrow drawn
/// with <see cref="DahliaGhostCursorView"/> and her words in a label beside
/// it. The pulse animation is not kept; the tip position, size, label cap and
/// show duration behave the same. Electron placed the window in
/// device-independent pixels on Windows; Godot window coordinates are screen
/// pixels, so the request coordinates are used as given (the renderer already
/// sends physical pixels from the window helper's frame).
/// </summary>
internal static class DahliaGhostCursor
{
    public const int Width = 280;
    public const int Height = 96;

    /// <summary>The pointer's tip, inside the window.</summary>
    public const int TipX = 6;
    public const int TipY = 6;

    public const int MinMs = 1500;
    public const int MaxMs = 15_000;
    public const int DefaultMs = 6000;
    public const int MaxLabel = 80;

    /// <summary>Whether the request names a point on the screen.</summary>
    public static string? Validate(double x, double y)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y))
            return "Send the point as {x, y}.";
        return null;
    }

    /// <summary>Her words beside the pointer: one line, at most <see cref="MaxLabel"/> characters.</summary>
    public static string NormalizeLabel(string? label)
    {
        if (string.IsNullOrEmpty(label))
            return string.Empty;
        var words = label.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var tidy = string.Join(" ", words);
        return tidy.Length > MaxLabel ? tidy[..MaxLabel] : tidy;
    }

    /// <summary>How long the cursor stays: 1.5 to 15 seconds, 6 by default.</summary>
    public static int ClampMs(double? ms)
    {
        if (ms is not double finite || !double.IsFinite(finite))
            return DefaultMs;
        return Math.Min(MaxMs, Math.Max(MinMs, (int)Math.Round(finite)));
    }

    public static string EscapeHtml(string text)
    {
        var builder = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            builder.Append(ch switch
            {
                '&' => "&amp;",
                '<' => "&lt;",
                '>' => "&gt;",
                '"' => "&quot;",
                '\'' => "&#39;",
                _ => ch.ToString(),
            });
        }
        return builder.ToString();
    }

    /// <summary>
    /// The page of the cursor: an arrow with a soft pulse at its tip, and her
    /// words beside it. Kept for parity with Electron's <c>ghostCursorPage</c>
    /// (the Godot overlay draws the same natively); the escaping rule — her
    /// words as text, never as markup — is asserted in tests.
    /// </summary>
    public static string GhostCursorPage(string label)
    {
        var words = label.Length > 0 ? $"<div class=\"label\">{EscapeHtml(label)}</div>" : string.Empty;
        return $"<!doctype html><html><head><meta charset=\"utf-8\"><style>\n"
            + "html,body{margin:0;background:transparent;overflow:hidden;font:13px system-ui,-apple-system,\"Segoe UI\",sans-serif}\n"
            + $"#pulse{{position:absolute;left:{TipX - 14}px;top:{TipY - 14}px;width:28px;height:28px;border-radius:50%;background:rgba(236,72,153,.35);"
            + "animation:pulse 1.2s ease-out infinite}}\n"
            + "@keyframes pulse{from{transform:scale(.4);opacity:1}to{transform:scale(1.6);opacity:0}}\n"
            + $"svg{{position:absolute;left:{TipX}px;top:{TipY}px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}}\n"
            + $".label{{position:absolute;left:30px;top:26px;max-width:{Width - 40}px;padding:5px 9px;border-radius:10px;background:rgba(236,72,153,.92);color:#fff;line-height:1.3;box-shadow:0 2px 8px rgba(0,0,0,.35)}}\n"
            + "</style></head><body><div class=\"pulse\"></div>"
            + "<svg width=\"26\" height=\"32\" viewBox=\"0 0 26 32\"><path d=\"M1 1 L1 25 L7.5 19 L12 30 L16.5 28 L12 17.5 L21 17.5 Z\" fill=\"rgba(236,72,153,.85)\" stroke=\"#fff\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/></svg>"
            + $"{words}</body></html>";
    }
}

/// <summary>The arrow of the ghost cursor, drawn natively in the overlay.</summary>
internal sealed partial class DahliaGhostCursorView : Control
{
    public override void _Draw()
    {
        var pink = new Color(0.925f, 0.282f, 0.600f, 0.9f);
        var ring = new Color(0.925f, 0.282f, 0.600f, 0.35f);
        DrawCircle(new Vector2(DahliaGhostCursor.TipX, DahliaGhostCursor.TipY), 14, ring);
        DrawColoredPolygon(
        [
            new Vector2(DahliaGhostCursor.TipX + 1, DahliaGhostCursor.TipY + 1),
            new Vector2(DahliaGhostCursor.TipX + 1, DahliaGhostCursor.TipY + 25),
            new Vector2(DahliaGhostCursor.TipX + 7.5f, DahliaGhostCursor.TipY + 19),
            new Vector2(DahliaGhostCursor.TipX + 12, DahliaGhostCursor.TipY + 30),
            new Vector2(DahliaGhostCursor.TipX + 16.5f, DahliaGhostCursor.TipY + 28),
            new Vector2(DahliaGhostCursor.TipX + 12, DahliaGhostCursor.TipY + 17.5f),
            new Vector2(DahliaGhostCursor.TipX + 21, DahliaGhostCursor.TipY + 17.5f),
        ], pink);
    }
}

/// <summary>
/// Shows the ghost cursor where she points, for a while; a new point moves it.
/// </summary>
internal sealed class DahliaGhostCursorService : IDisposable
{
    private readonly Node _parent;
    private readonly IDisposable _registration;
    private Window? _window;
    private Label? _label;
    private Godot.Timer? _hideTimer;
    private bool _disposed;

    private DahliaGhostCursorService(Node parent, IDisposable registration)
    {
        _parent = parent;
        _registration = registration;
    }

    public static DahliaGhostCursorService Attach(IEventContext context, Node parent)
    {
        DahliaGhostCursorService? service = null;
        var registration = context.RegisterInvokeHandler(
            DahliaEvents.ShowGhostCursor,
            (DahliaGhostCursorRequestPayload request, CancellationToken _) =>
                Task.FromResult(service!.Answer(request)));
        service = new DahliaGhostCursorService(parent, registration);
        return service;
    }

    internal DahliaGhostCursorResultPayload Answer(DahliaGhostCursorRequestPayload request)
    {
        var invalid = DahliaGhostCursor.Validate(request.X, request.Y);
        if (invalid is not null)
            return new DahliaGhostCursorResultPayload(false, invalid);
        var label = DahliaGhostCursor.NormalizeLabel(request.Label);
        var ms = DahliaGhostCursor.ClampMs(request.Ms);
        try
        {
            Show(request.X, request.Y, label, ms);
            return new DahliaGhostCursorResultPayload(true, null);
        }
        catch (Exception error)
        {
            return new DahliaGhostCursorResultPayload(false, error.Message.Length > 0 ? error.Message : "The pointer couldn't be shown.");
        }
    }

    private void Show(double x, double y, string label, int ms)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var window = EnsureWindow();
        window.Position = new Vector2I((int)Math.Round(x) - DahliaGhostCursor.TipX, (int)Math.Round(y) - DahliaGhostCursor.TipY);
        if (_label is not null)
        {
            _label.Text = label;
            _label.Visible = label.Length > 0;
        }
        window.Show();
        if (_hideTimer is not null)
        {
            _hideTimer.Stop();
            _hideTimer.WaitTime = ms / 1000.0;
            _hideTimer.Start();
        }
    }

    private Window EnsureWindow()
    {
        if (_window is not null && GodotObject.IsInstanceValid(_window))
            return _window;
        var window = new Window
        {
            Title = "Dahlia",
            Size = new Vector2I(DahliaGhostCursor.Width, DahliaGhostCursor.Height),
            TransparentBg = true,
            Borderless = true,
            AlwaysOnTop = true,
            Unresizable = true,
            Unfocusable = true,
            MousePassthrough = true,
        };
        var view = new DahliaGhostCursorView
        {
            Position = Vector2.Zero,
            Size = new Vector2(DahliaGhostCursor.Width, DahliaGhostCursor.Height),
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        window.AddChild(view);
        _label = new Label
        {
            Position = new Vector2(30, 26),
            Size = new Vector2(DahliaGhostCursor.Width - 40, DahliaGhostCursor.Height - 30),
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        _label.AddThemeFontSizeOverride("font_size", 13);
        _label.AddThemeColorOverride("font_color", new Color(1, 1, 1));
        _label.AddThemeColorOverride("font_shadow_color", new Color(0, 0, 0, 0.7f));
        _label.AddThemeConstantOverride("shadow_offset_x", 1);
        _label.AddThemeConstantOverride("shadow_offset_y", 1);
        window.AddChild(_label);
        _hideTimer = new Godot.Timer { OneShot = true };
        var timer = _hideTimer;
        timer.Timeout += () =>
        {
            if (GodotObject.IsInstanceValid(window) && window.Visible)
                window.Hide();
        };
        window.AddChild(timer);
        _parent.AddChild(window);
        _window = window;
        return window;
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _registration.Dispose();
        if (_window is not null && GodotObject.IsInstanceValid(_window))
            _window.QueueFree();
        _window = null;
    }
}
