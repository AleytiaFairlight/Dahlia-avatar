using Godot;

/// <summary>
/// Dahlia: a guard for the app's local database. Chromium keeps IndexedDB
/// (the app's chats, settings, animation library and model files) in LevelDB
/// folders, and when it finds a checksum error in one at start-up it deletes
/// the whole folder without asking. Before any window opens, this checks the
/// write-ahead logs of those folders itself; where one is damaged it first
/// copies the folder to diagnostics/ in the app's data folder, then tries the
/// two repairs that lose nothing or only an unfinished last write.
///
/// Port of Electron's <c>src/main/dahlia-storage-guard.ts</c>: the same
/// Castagnoli CRC32C engine, the same log check and repairs, the same
/// copy-before-touching rule. Unlike AIRI's LevelDB guard (which stops the
/// app with a dialog when a repair fails), Dahlia starts anyway (her chats
/// are on her server too), with the copy kept.
/// </summary>
internal sealed record DahliaWalValidationResult(
    bool Valid,
    int TotalRecords,
    int LastValidOffset,
    string? Error);

internal sealed record DahliaWalRepairResult(
    bool Repaired,
    byte[]? RepairedBuffer,
    int? TotalRecords,
    string? Strategy);

internal sealed record DahliaStorageFinding(
    string Database,
    string File,
    string Error,
    string? Copy,
    string? Repaired,
    int? Records);

internal static class DahliaStorageGuard
{
    private const uint Crc32CPolynomial = 0x82F63B78;
    private const uint MaskDelta = 0xA282EAD8;
    private const int LevelDbBlockSize = 32768;

    /// <summary>
    /// Valid 7-byte empty LevelDB record header (type 1, length 0, CRC
    /// computed). Used to safely replace isolated corrupted headers without
    /// breaking subsequent records.
    /// </summary>
    internal static readonly byte[] ZeroRecordHeader = [0x05, 0x2B, 0x28, 0x43, 0x00, 0x00, 0x01];

    /// <summary>Copies of damaged databases older than this many are removed, oldest first.</summary>
    private const int KeepCopies = 3;

    private static readonly uint[] Crc32CTable = BuildCrc32CTable();

    private static uint[] BuildCrc32CTable()
    {
        var table = new uint[256];
        for (var i = 0; i < 256; i++)
        {
            var crc = (uint)i;
            for (var j = 0; j < 8; j++)
            {
                crc = (crc & 1) != 0 ? Crc32CPolynomial ^ (crc >> 1) : crc >> 1;
            }

            table[i] = crc;
        }

        return table;
    }

    public static uint ComputeCrc32C(byte[] buffer, int offset = 0, int? length = null)
    {
        var end = offset + (length ?? buffer.Length - offset);
        var crc = 0xFFFFFFFFu;
        for (var i = offset; i < end; i++)
        {
            crc = Crc32CTable[(crc ^ buffer[i]) & 0xFF] ^ (crc >> 8);
        }

        return crc ^ 0xFFFFFFFFu;
    }

    public static uint UnmaskCrc32C(uint masked)
    {
        var rotated = masked - MaskDelta;
        return ((rotated >> 17) | (rotated << 15));
    }

    public static uint MaskCrc32C(uint crc)
    {
        return (((crc << 17) | (crc >> 15)) + MaskDelta);
    }

    public static DahliaWalValidationResult ValidateWalBuffer(byte[] buffer)
    {
        var offset = 0;
        var recordCount = 0;
        var lastValidOffset = 0;

        while (offset < buffer.Length)
        {
            var blockRemaining = LevelDbBlockSize - (offset % LevelDbBlockSize);

            // LevelDB record header is 7 bytes: 4 bytes CRC + 2 bytes length + 1 byte type
            if (blockRemaining < 7)
            {
                // Trailing zero-padding at block end
                offset += blockRemaining;
                continue;
            }

            if (offset + 7 > buffer.Length)
            {
                return new DahliaWalValidationResult(false, recordCount, lastValidOffset, $"Incomplete record header at file tail (offset {offset})");
            }

            var maskedCrc = (uint)(buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24));
            var length = buffer[offset + 4] | (buffer[offset + 5] << 8);
            var type = buffer[offset + 6];

            // Zero-type padding
            if (type == 0 && length == 0)
            {
                offset += blockRemaining;
                continue;
            }

            if (7 + length > blockRemaining)
            {
                return new DahliaWalValidationResult(false, recordCount, lastValidOffset, $"Record length {length} exceeds block boundary at offset {offset}");
            }

            if (offset + 7 + length > buffer.Length)
            {
                return new DahliaWalValidationResult(false, recordCount, lastValidOffset, $"Truncated record payload at offset {offset} (expected {7 + length} bytes, file ends early)");
            }

            var expectedCrc = UnmaskCrc32C(maskedCrc);
            var actualCrc = ComputeCrc32C(buffer, offset + 6, 1 + length);

            if (expectedCrc != actualCrc)
            {
                return new DahliaWalValidationResult(false, recordCount, lastValidOffset, $"CRC32C checksum mismatch at offset {offset} (expected 0x{expectedCrc:x}, got 0x{actualCrc:x})");
            }

            recordCount++;
            offset += 7 + length;
            lastValidOffset = offset;
        }

        return new DahliaWalValidationResult(true, recordCount, lastValidOffset, null);
    }

    public static DahliaWalValidationResult ValidateLevelDbWalLog(string filePath)
    {
        try
        {
            return ValidateWalBuffer(File.ReadAllBytes(filePath));
        }
        catch (Exception error)
        {
            return new DahliaWalValidationResult(false, 0, 0, error.Message);
        }
    }

    /// <summary>
    /// Attempts non-destructive repairs on a corrupted LevelDB WAL buffer:
    /// 1. Zero-header patch: if a 7-byte header was corrupted but subsequent
    /// records remain valid.
    /// 2. Truncation: truncates cleanly to the last valid record boundary
    /// (dropping only incomplete tail writes).
    /// </summary>
    public static DahliaWalRepairResult AttemptWalRepair(byte[] buffer, int lastValidOffset)
    {
        // Strategy 1: Test replacing 7 corrupted bytes at lastValidOffset with a zero-length record
        if (lastValidOffset + 7 <= buffer.Length)
        {
            var candidate = (byte[])buffer.Clone();
            ZeroRecordHeader.CopyTo(candidate, lastValidOffset);
            var test = ValidateWalBuffer(candidate);
            if (test.Valid)
            {
                return new DahliaWalRepairResult(true, candidate, test.TotalRecords, "zero_header_patch");
            }
        }

        // Strategy 2: Clean truncation to last valid offset
        if (lastValidOffset > 0)
        {
            var candidate = buffer[..lastValidOffset];
            var test = ValidateWalBuffer(candidate);
            if (test.Valid)
            {
                return new DahliaWalRepairResult(true, candidate, test.TotalRecords, "truncation");
            }
        }

        return new DahliaWalRepairResult(false, null, null, null);
    }

    /// <summary>
    /// Checks the IndexedDB databases under the app's data folder and repairs
    /// what it safely can. Never throws and never stops the app: a problem
    /// here must not keep her from starting. Returns what it found.
    /// </summary>
    public static List<DahliaStorageFinding> Guard(string userDataPath, Func<long>? nowMilliseconds = null)
    {
        var findings = new List<DahliaStorageFinding>();
        try
        {
            var now = nowMilliseconds ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            var indexedDbDir = Path.Combine(userDataPath, "IndexedDB");
            if (!Directory.Exists(indexedDbDir))
            {
                return findings;
            }

            var databases = Directory.GetDirectories(indexedDbDir, "*.leveldb");
            foreach (var database in databases)
            {
                // Without CURRENT the database was never opened.
                if (!File.Exists(Path.Combine(database, "CURRENT")))
                {
                    continue;
                }

                foreach (var log in Directory.GetFiles(database, "*.log"))
                {
                    var result = ValidateLevelDbWalLog(log);
                    if (result.Valid)
                    {
                        continue;
                    }

                    string? copy = null;
                    string? repaired = null;
                    int? records = null;
                    var finding = new DahliaStorageFinding(Path.GetFileName(database), Path.GetFileName(log), result.Error ?? "damaged", null, null, null);
                    var copyDir = Path.Combine(userDataPath, "diagnostics", $"damaged-indexeddb-{now()}-{Path.GetFileName(database)}");
                    try
                    {
                        Directory.CreateDirectory(copyDir);
                        CopyDirectory(database, copyDir);
                        copy = copyDir;
                    }
                    catch (Exception error)
                    {
                        GD.PushError($"Dahlia storage guard: the damaged database couldn't be copied: {error.Message}");
                    }

                    // Only with the copy made is the log itself touched.
                    if (copy is not null)
                    {
                        var repair = AttemptWalRepair(File.ReadAllBytes(log), result.LastValidOffset);
                        if (repair.Repaired && repair.RepairedBuffer is not null)
                        {
                            File.WriteAllBytes(log, repair.RepairedBuffer);
                            repaired = repair.Strategy;
                            records = repair.TotalRecords;
                        }
                    }

                    GD.PushError($"Dahlia storage guard: {finding.Database}/{finding.File} is damaged ({finding.Error}); {(repaired is not null ? $"repaired ({repaired})" : "not repaired")}; copy: {copy ?? "none"}");
                    findings.Add(finding with { Copy = copy, Repaired = repaired, Records = records });
                }
            }

            if (findings.Count > 0)
            {
                PruneCopies(Path.Combine(userDataPath, "diagnostics"));
            }
        }
        catch (Exception error)
        {
            GD.PushError($"Dahlia storage guard failed: {error.Message}");
        }

        return findings;
    }

    private static void PruneCopies(string diagnostics)
    {
        try
        {
            var copies = Directory.GetDirectories(diagnostics, "damaged-indexeddb-*")
                .OrderBy(static path => path, StringComparer.Ordinal)
                .ToArray();
            foreach (var old in copies.Take(Math.Max(0, copies.Length - KeepCopies)))
            {
                Directory.Delete(old, recursive: true);
            }
        }
        catch
        {
            // The copies stay.
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        foreach (var directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));
        }

        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            File.Copy(file, Path.Combine(destination, Path.GetRelativePath(source, file)), overwrite: true);
        }
    }
}
