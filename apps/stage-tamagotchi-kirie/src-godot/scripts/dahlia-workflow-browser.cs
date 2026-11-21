using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Eventa;

/// <summary>
/// Dahlia's browser for the owner's ticket work, on
/// <c>eventa:invoke:dahlia:workflow:call</c>: Chrome reading the ticket mail in
/// Outlook on the web and the tickets in ConnectWise Manage, and adding a note
/// to a ticket once the owner approved it. Her server decides what to do and
/// calls the workflow tools, which come here with the settings (where things
/// are on the pages) in every call, so none are kept here. Her chat never sees
/// these tools.
///
/// Port of Electron's <c>src/main/dahlia-workflow-browser.ts</c>.
///
/// Difference from Electron: Electron drove Chrome with Playwright
/// (playwright-core, a persistent profile of Dahlia's own). The Kirie host is
/// a Godot .NET process with no Playwright/Chromium driver, so the steps that
/// need a browser answer that Chrome isn't driven here yet and say where to
/// run them instead. The pure step helpers (sign-in pages, ticket links, label
/// matching, message keys, text cutting, answer fitting) are ported whole, so
/// the day a browser host exists the steps below keep their shapes and only
/// the driving changes.
/// </summary>
internal static class DahliaWorkflowBrowser
{
    /// <summary>How her server learns that a site sent the browser to its sign-in page.</summary>
    public const string SignInMark = "SIGNIN:";

    /// <summary>Her server keeps 16,000 characters of a result: answers stay under this so their JSON is never cut.</summary>
    public const int MaxAnswerChars = 15_000;

    private static readonly HashSet<string> Ops = new(StringComparer.Ordinal)
    {
        "signin", "mail_list", "mail_open", "ticket_read", "ticket_note",
    };

    /// <summary>The error that tells her server to have the owner sign in again.</summary>
    public static InvalidOperationException SignInError(string site) =>
        new($"{SignInMark}{site} wants you to sign in again: press Sign in on the Tickets page (Settings > Modules > Tickets).");

    /// <summary>A sign-in page, by its address: Microsoft's login hosts, or a /login path.</summary>
    public static bool IsSignInPage(string? url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed))
            return false;
        return parsed.Host.StartsWith("login.", StringComparison.OrdinalIgnoreCase)
            || parsed.Host.Contains("microsoftonline", StringComparison.OrdinalIgnoreCase)
            || parsed.AbsolutePath.ToLowerInvariant().Contains("/login");
    }

    /// <summary>ConnectWise over https, or a page on this PC (tests).</summary>
    public static bool IsTicketLink(string? url)
    {
        if (string.IsNullOrEmpty(url))
            return false;
        return url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            || Regex.IsMatch(url, "^http://127\\.0\\.0\\.1[:/]", RegexOptions.IgnoreCase);
    }

    public static string EscapeRegExp(string text) => Regex.Escape(text);

    /// <summary>The whole text of a label or button, ignoring case and the spaces around it.</summary>
    public static Regex ExactName(string name) =>
        new($"^\\s*{Regex.Escape(name.Trim())}\\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Outlook names a folder with its unread count ("Tickets 3 unread"): the start of the name matches.</summary>
    public static Regex FolderName(string folder) =>
        new($"^{Regex.Escape(folder.Trim())}(\\s|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>A message's key: Outlook's conversation id, or a hash of its label without the unread mark.</summary>
    public static string MailKey(string? convId, string label, string unreadPrefix)
    {
        if (!string.IsNullOrEmpty(convId))
            return $"conv:{convId}";
        var read = label.StartsWith(unreadPrefix, StringComparison.OrdinalIgnoreCase)
            ? label[unreadPrefix.Length..].Trim() : label;
        return $"label:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(read)))[..24].ToLowerInvariant()}";
    }

    /// <summary>Finds the message again: by its conversation id, or by its place in the list.</summary>
    public static string MailSelector(string messageSelector, string? convId, int index) =>
        convId is not null
            ? $"{messageSelector}[data-convid=\"{convId.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"]"
            : $":nth-match({messageSelector}, {index + 1})";

    /// <summary>Text in one paragraph-tidy piece, cut at a word to at most max characters.</summary>
    public static string Cut(string? text, int max)
    {
        var tidy = Regex.Replace(text ?? string.Empty, "\n\\s*\n\\s*\n\\s*", "\n\n").Trim();
        if (tidy.Length <= max)
            return tidy;
        var piece = tidy[..max];
        var space = piece.LastIndexOf(' ');
        return $"{(space > max * 0.75 ? piece[..space] : piece)} …";
    }

    /// <summary>The answer shortened (its longest text first) until its JSON fits her server's result.</summary>
    public static JsonObject FitAnswer(JsonObject answer, string field)
    {
        while (answer.ToJsonString().Length > MaxAnswerChars
            && answer[field]?.GetValue<string>() is string text && text.Length > 0)
        {
            var over = answer.ToJsonString().Length - MaxAnswerChars;
            answer[field] = Cut(text, Math.Max(0, text.Length - over - 200));
        }
        return answer;
    }

    public static string TidySpaces(string text) =>
        Regex.Replace(text, "\\s+", " ").Trim();

    public static bool IsKnownOp(string? op) => op is not null && Ops.Contains(op);

    internal static JsonObject BrowserUnavailable(string op) => new()
    {
        ["ok"] = false,
        ["error"] = $"Google Chrome isn't driven by the Kirie host (workflow step {op}): ticket mail and ConnectWise need the Playwright browser host. Run the Electron app for ticket work.",
    };
}

internal sealed class DahliaWorkflowBrowserService : IDisposable
{
    private readonly IDisposable _registration;
    private bool _disposed;

    private DahliaWorkflowBrowserService(IDisposable registration)
    {
        _registration = registration;
    }

    public static DahliaWorkflowBrowserService Attach(IEventContext context)
    {
        DahliaWorkflowBrowserService? service = null;
        var registration = context.RegisterInvokeHandler(
            DahliaEvents.WorkflowCall,
            async (DahliaHostCallRequest payload, CancellationToken cancellationToken) =>
            {
                try
                {
                    var request = JsonNode.Parse(payload.Json) as JsonObject
                        ?? DahliaWindowHelper.ErrorNode("Unknown workflow step.");
                    return DahliaContracts.Answer(await service!.AnswerAsync(request, cancellationToken));
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception error)
                {
                    return DahliaContracts.OkError(error.Message.Length > 0 ? error.Message : "The step failed.");
                }
            });
        service = new DahliaWorkflowBrowserService(registration);
        return service;
    }

    internal Task<JsonObject> AnswerAsync(JsonObject request, CancellationToken cancellationToken)
    {
        var op = request["op"]?.GetValue<string>();
        if (!DahliaWorkflowBrowser.IsKnownOp(op))
            return Task.FromResult(DahliaWindowHelper.ErrorNode("Unknown workflow step."));
        // Every step needs Chrome (Playwright): the Kirie host drives no
        // browser. The pure helpers above stay ported for the browser host.
        return Task.FromResult(DahliaWorkflowBrowser.BrowserUnavailable(op!));
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _registration.Dispose();
    }
}
