// Dahlia: a guard for the app's local database. Chromium keeps IndexedDB (the app's chats, settings, animation
// library and model files) in LevelDB folders, and when it finds a checksum error in one at start-up it deletes
// the whole folder without asking. Before any window opens, this checks the write-ahead logs of those folders
// itself; where one is damaged it first copies the folder to diagnostics/ in the app's data folder, then tries
// the two repairs that lose nothing or only an unfinished last write, and reports what it found to Dahlia's
// error log. The checksum code, the log check and the repairs are from dasilva333/airi (MIT,
// apps/stage-tamagotchi/src/main/app/leveldb-guard.ts at 24c706d9d), which stops the app with a dialog when a
// repair fails; Dahlia starts anyway (her chats are on her server too), with the copy kept. This file is Dahlia's.

import type { Buffer as NodeBuffer } from 'node:buffer'

import fs from 'node:fs'
import path from 'node:path'

import { Buffer } from 'node:buffer'

import { errorMessageFrom } from '@moeru/std'

// ============================================================================
// Castagnoli CRC32C Engine (Matching LevelDB specification)
// ============================================================================

const CRC32C_POLYNOMIAL = 0x82F63B78
const crc32cTable = new Uint32Array(256)

for (let i = 0; i < 256; i++) {
  let crc = i
  for (let j = 0; j < 8; j++) {
    crc = (crc & 1) ? (CRC32C_POLYNOMIAL ^ (crc >>> 1)) : (crc >>> 1)
  }
  crc32cTable[i] = crc >>> 0
}

export function computeCrc32c(buf: NodeBuffer, offset = 0, length = buf.length): number {
  let crc = 0xFFFFFFFF
  for (let i = offset; i < offset + length; i++) {
    crc = crc32cTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const K_MASK_DELTA = 0xA282EAD8 >>> 0

export function unmaskCrc32c(masked: number): number {
  const rot = (masked - K_MASK_DELTA) >>> 0
  return ((rot >>> 17) | (rot << 15)) >>> 0
}

// ============================================================================
// LevelDB WAL Log Validator
// ============================================================================

export interface WalValidationResult {
  valid: boolean
  totalRecords: number
  lastValidOffset: number
  error?: string
}

const LEVELDB_BLOCK_SIZE = 32768 // 32 KB

export function validateWalBuffer(buf: NodeBuffer): WalValidationResult {
  let offset = 0
  let recordCount = 0
  let lastValidOffset = 0

  while (offset < buf.length) {
    const blockRemaining = LEVELDB_BLOCK_SIZE - (offset % LEVELDB_BLOCK_SIZE)

    // LevelDB record header is 7 bytes: 4 bytes CRC + 2 bytes length + 1 byte type
    if (blockRemaining < 7) {
      // Trailing zero-padding at block end
      offset += blockRemaining
      continue
    }

    if (offset + 7 > buf.length) {
      return {
        valid: false,
        totalRecords: recordCount,
        lastValidOffset,
        error: `Incomplete record header at file tail (offset ${offset})`,
      }
    }

    const maskedCrc = buf.readUInt32LE(offset)
    const length = buf.readUInt16LE(offset + 4)
    const type = buf.readUInt8(offset + 6)

    // Zero-type padding
    if (type === 0 && length === 0) {
      offset += blockRemaining
      continue
    }

    if (7 + length > blockRemaining) {
      return {
        valid: false,
        totalRecords: recordCount,
        lastValidOffset,
        error: `Record length ${length} exceeds block boundary at offset ${offset}`,
      }
    }

    if (offset + 7 + length > buf.length) {
      return {
        valid: false,
        totalRecords: recordCount,
        lastValidOffset,
        error: `Truncated record payload at offset ${offset} (expected ${7 + length} bytes, file ends early)`,
      }
    }

    const expectedCrc = unmaskCrc32c(maskedCrc)
    const actualCrc = computeCrc32c(buf, offset + 6, 1 + length)

    if (expectedCrc !== actualCrc) {
      return {
        valid: false,
        totalRecords: recordCount,
        lastValidOffset,
        error: `CRC32C checksum mismatch at offset ${offset} (expected 0x${expectedCrc.toString(16)}, got 0x${actualCrc.toString(16)})`,
      }
    }

    recordCount++
    offset += 7 + length
    lastValidOffset = offset
  }

  return {
    valid: true,
    totalRecords: recordCount,
    lastValidOffset,
  }
}

export function validateLevelDbWalLog(filePath: string): WalValidationResult {
  try {
    const buf = fs.readFileSync(filePath)
    return validateWalBuffer(buf)
  }
  catch (err) {
    return {
      valid: false,
      totalRecords: 0,
      lastValidOffset: 0,
      error: errorMessageFrom(err) ?? String(err),
    }
  }
}

/**
 * Valid 7-byte empty LevelDB record header (type 1, length 0, CRC computed).
 * Used to safely replace isolated corrupted headers without breaking subsequent records.
 */
const ZERO_RECORD_HEADER = Buffer.from('052b2843000001', 'hex')

export interface WalRepairResult {
  repaired: boolean
  repairedBuf?: NodeBuffer
  totalRecords?: number
  strategy?: 'zero_header_patch' | 'truncation'
}

/**
 * Attempts non-destructive repairs on a corrupted LevelDB WAL buffer:
 * 1. Zero-header patch: if a 7-byte header was corrupted but subsequent records remain valid.
 * 2. Truncation: truncates cleanly to the last valid record boundary (dropping only incomplete tail writes).
 */
export function attemptWalRepair(buf: NodeBuffer, lastValidOffset: number): WalRepairResult {
  // Strategy 1: Test replacing 7 corrupted bytes at lastValidOffset with a zero-length record
  if (lastValidOffset + 7 <= buf.length) {
    const candidate = Buffer.from(buf)
    ZERO_RECORD_HEADER.copy(candidate, lastValidOffset)
    const testResult = validateWalBuffer(candidate)
    if (testResult.valid) {
      return {
        repaired: true,
        repairedBuf: candidate,
        totalRecords: testResult.totalRecords,
        strategy: 'zero_header_patch',
      }
    }
  }

  // Strategy 2: Clean truncation to last valid offset
  if (lastValidOffset > 0) {
    const candidate = Buffer.from(buf.subarray(0, lastValidOffset))
    const testResult = validateWalBuffer(candidate)
    if (testResult.valid) {
      return {
        repaired: true,
        repairedBuf: candidate,
        totalRecords: testResult.totalRecords,
        strategy: 'truncation',
      }
    }
  }

  return { repaired: false }
}

// ============================================================================
// Main Pre-flight Interceptor
// ============================================================================

export interface DahliaStorageFinding {
  database: string
  file: string
  error: string
  /** Where the folder was copied to before anything was changed; undefined when the copy failed. */
  copy?: string
  /** How the log was repaired, or undefined when it couldn't be. */
  repaired?: 'zero_header_patch' | 'truncation'
  records?: number
}

/** Copies of damaged databases older than this many are removed, oldest first. */
const KEEP_COPIES = 3

/**
 * Checks the IndexedDB databases under the app's data folder and repairs what it safely can. Never throws and
 * never stops the app: a problem here must not keep her from starting. Returns what it found.
 */
export function guardDahliaStorage(userDataPath: string, now: () => number = Date.now): DahliaStorageFinding[] {
  const findings: DahliaStorageFinding[] = []
  try {
    const indexedDbDir = path.join(userDataPath, 'IndexedDB')
    if (!fs.existsSync(indexedDbDir))
      return findings

    const databases = fs.readdirSync(indexedDbDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.endsWith('.leveldb'))
      .map(entry => path.join(indexedDbDir, entry.name))
    for (const database of databases) {
      // Without CURRENT the database was never opened.
      if (!fs.existsSync(path.join(database, 'CURRENT')))
        continue
      for (const file of fs.readdirSync(database).filter(name => name.endsWith('.log'))) {
        const log = path.join(database, file)
        const result = validateLevelDbWalLog(log)
        if (result.valid)
          continue

        const finding: DahliaStorageFinding = { database: path.basename(database), file, error: result.error ?? 'damaged' }
        const copy = path.join(userDataPath, 'diagnostics', `damaged-indexeddb-${now()}-${path.basename(database)}`)
        try {
          fs.mkdirSync(copy, { recursive: true })
          fs.cpSync(database, copy, { recursive: true })
          finding.copy = copy
        }
        catch (error) {
          console.error('Dahlia storage guard: the damaged database couldn\'t be copied:', error)
        }

        // Only with the copy made is the log itself touched.
        if (finding.copy) {
          const repair = attemptWalRepair(fs.readFileSync(log), result.lastValidOffset)
          if (repair.repaired && repair.repairedBuf) {
            fs.writeFileSync(log, repair.repairedBuf)
            finding.repaired = repair.strategy
            finding.records = repair.totalRecords
          }
        }

        console.error(`Dahlia storage guard: ${finding.database}/${file} is damaged (${finding.error}); ${finding.repaired ? `repaired (${finding.repaired})` : 'not repaired'}; copy: ${finding.copy ?? 'none'}`)
        findings.push(finding)
      }
    }

    if (findings.length > 0)
      pruneCopies(path.join(userDataPath, 'diagnostics'))
  }
  catch (error) {
    console.error('Dahlia storage guard failed:', error)
  }
  return findings
}

function pruneCopies(diagnostics: string) {
  try {
    const copies = fs.readdirSync(diagnostics).filter(name => name.startsWith('damaged-indexeddb-')).sort()
    for (const old of copies.slice(0, Math.max(0, copies.length - KEEP_COPIES)))
      fs.rmSync(path.join(diagnostics, old), { recursive: true, force: true })
  }
  catch {
    // The copies stay.
  }
}
