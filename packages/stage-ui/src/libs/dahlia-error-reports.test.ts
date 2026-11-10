import type { DahliaErrorReport } from './dahlia-error-reports'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDahliaErrorReporter } from './dahlia-error-reports'

vi.mock('../stores/dahlia-auth', () => ({ dahliaHeaders: () => ({}), dahliaKey: () => 'key' }))

describe('dahlia error reports', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends errors in a batch, folds repeats within the quiet time and counts them on the next report', async () => {
    const sent: DahliaErrorReport[][] = []
    const reporter = createDahliaErrorReporter({
      send: async (reports) => {
        sent.push(reports)
        return 'sent'
      },
      now: () => Date.now(),
      platform: 'desktop',
    })

    // The same error from the same place, as a loop or a timer would throw it.
    const fail = () => reporter.report('error', new TypeError('x is undefined'))
    fail()
    fail()
    reporter.report('unhandledrejection', 'no network')
    await vi.advanceTimersByTimeAsync(2_000)

    expect(sent).toHaveLength(1)
    expect(sent[0].map(r => [r.kind, r.message, r.platform])).toEqual([
      ['error', 'TypeError: x is undefined', 'desktop'],
      ['unhandledrejection', 'no network', 'desktop'],
    ])

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    fail()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sent[1][0].repeats).toBe(1)
  })

  it('keeps reports while it can not send, retries later and takes the app version from a source', async () => {
    const results: Array<'sent' | 'retry'> = ['retry', 'sent']
    const sent: DahliaErrorReport[][] = []
    let canSend = false
    const reporter = createDahliaErrorReporter({
      send: async (reports) => {
        sent.push(reports)
        return results.shift()!
      },
      canSend: () => canSend,
      platform: 'android',
    })

    await reporter.takeFrom(async () => ({ appVersion: '0.12.2-beta.6', reports: [{ kind: 'crash', source: 'android', message: 'java.lang.IllegalStateException' }, { message: '  ' }] }))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sent).toHaveLength(0)
    expect(reporter.pending()).toBe(1)

    canSend = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toHaveLength(2)
    expect(sent[1][0]).toMatchObject({ kind: 'crash', source: 'android', appVersion: '0.12.2-beta.6' })
    expect(reporter.pending()).toBe(0)
  })
})
