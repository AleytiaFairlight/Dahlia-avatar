// Dahlia: tests for dahlia-storage-guard.ts, the guard for the app's local database.
import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { computeCrc32c, guardDahliaStorage, validateWalBuffer } from './dahlia-storage-guard'

const K_MASK_DELTA = 0xA282EAD8

/** One whole LevelDB log record (type 1) with a correct masked CRC32C. */
function record(payload: string) {
  const data = Buffer.from(payload)
  const body = Buffer.concat([Buffer.from([1]), data])
  const crc = computeCrc32c(body)
  const masked = ((((crc >>> 15) | (crc << 17)) >>> 0) + K_MASK_DELTA) >>> 0
  const header = Buffer.alloc(7)
  header.writeUInt32LE(masked, 0)
  header.writeUInt16LE(data.length, 4)
  header.writeUInt8(1, 6)
  return Buffer.concat([header, data])
}

const dirs: string[] = []
function database(log: Buffer) {
  const userData = mkdtempSync(join(tmpdir(), 'dahlia-guard-'))
  dirs.push(userData)
  const db = join(userData, 'IndexedDB', 'app_0.indexeddb.leveldb')
  mkdirSync(db, { recursive: true })
  writeFileSync(join(db, 'CURRENT'), 'MANIFEST-000001\n')
  writeFileSync(join(db, '000003.log'), log)
  return { userData, log: join(db, '000003.log') }
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('dahlia storage guard', () => {
  it('leaves a healthy database alone', () => {
    const healthy = Buffer.concat([record('first'), record('second')])
    expect(validateWalBuffer(healthy)).toMatchObject({ valid: true, totalRecords: 2 })
    const { userData, log } = database(healthy)
    expect(guardDahliaStorage(userData)).toEqual([])
    expect(readFileSync(log).equals(healthy)).toBe(true)
    expect(guardDahliaStorage(join(userData, 'nowhere'))).toEqual([])
  })

  it('copies a damaged database first, then cuts off an unfinished last write', () => {
    const whole = Buffer.concat([record('first'), record('second')])
    const torn = Buffer.concat([whole, record('third, never finished').subarray(0, 12)])
    const { userData, log } = database(torn)

    const [finding] = guardDahliaStorage(userData, () => 42)
    expect(finding).toMatchObject({ database: 'app_0.indexeddb.leveldb', file: '000003.log', repaired: 'truncation', records: 2 })
    expect(readFileSync(log).equals(whole), 'the two whole records are kept').toBe(true)
    expect(readFileSync(join(finding.copy!, '000003.log')).equals(torn), 'the copy is the database as it was found').toBe(true)
    expect(guardDahliaStorage(userData), 'healthy afterwards').toEqual([])
  })

  it('keeps the copy when nothing can be repaired, and only the newest copies', () => {
    const { userData, log } = database(Buffer.from('this was never a log file at all'))
    for (let run = 1; run <= 5; run++) {
      const [finding] = guardDahliaStorage(userData, () => run)
      expect(finding.repaired).toBeUndefined()
      expect(finding.copy).toBeDefined()
    }
    expect(readFileSync(log).toString()).toBe('this was never a log file at all')
    expect(readdirSync(join(userData, 'diagnostics'))).toHaveLength(3)
  })
})
