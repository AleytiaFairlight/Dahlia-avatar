import type { DahliaPcReport, DahliaPcSample } from './dahlia-pc-awareness'

import { describe, expect, it, vi } from 'vitest'

import { DahliaPcAwareness, PC_MAX_FAILURES, PC_SAMPLE_MS, PC_SLOW_MS } from './dahlia-pc-awareness'

function repeat<Sample extends DahliaPcSample | Error>(times: number, sample: Sample): Sample[] {
  return Array.from<Sample>({ length: times }).fill(sample)
}

function awareness(samples: Array<DahliaPcSample | Error>) {
  let clock = 0
  let index = 0
  const reports: Array<DahliaPcReport & { at: number }> = []
  const sleeps: number[] = []
  const stop = vi.fn(async () => {})
  const instance: DahliaPcAwareness = new DahliaPcAwareness({
    sample: async () => {
      const sample = samples[index++]
      if (index >= samples.length)
        void instance.stop()
      if (sample instanceof Error)
        throw sample
      return sample
    },
    report: async (report) => {
      reports.push({ ...report, at: clock })
    },
    stop,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
  })
  return { instance, reports, sleeps, stop }
}

const code: DahliaPcSample = { app: 'Code', title: 'Program.cs - nadekobot', idleSeconds: 2, cpu: 20, memory: 50 }
const browser: DahliaPcSample = { app: 'firefox', title: 'Docs', idleSeconds: 1 }

describe('dahlia pc awareness', () => {
  it('reports when the window in front or being away changes, and once a minute otherwise', async () => {
    const { instance, reports, stop } = awareness([code, code, browser, { ...browser, idleSeconds: 130 }, ...repeat(7, { ...browser, idleSeconds: 200 })])
    await instance.start()

    expect(reports.map(report => [report.at, report.app, report.idleSeconds])).toEqual([
      [0, 'Code', 2],
      [2 * PC_SAMPLE_MS, 'firefox', 1],
      [3 * PC_SAMPLE_MS, 'firefox', 130],
      [9 * PC_SAMPLE_MS, 'firefox', 200],
    ])
    expect(reports[0]).toMatchObject({ title: 'Program.cs - nadekobot', cpu: 20, memory: 50, recent: [] })
    expect(instance.state.running).toBe(false)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('counts the minutes of each app in front, not her own window and not time away', async () => {
    const own: DahliaPcSample = { app: 'Dahlia', title: 'Chat', own: true, idleSeconds: 0 }
    const { instance, reports } = awareness([
      ...repeat(13, code),
      ...repeat(7, browser),
      own,
      own,
      { ...browser, idleSeconds: 300 },
      code,
      // The last sample only ends the test's loop.
      code,
    ])
    await instance.start()

    const last = reports.at(-1)!
    expect(last).toMatchObject({ app: 'Code', title: 'Program.cs - nadekobot' })
    expect(last.recent).toEqual([{ app: 'Code', minutes: 2 }, { app: 'firefox', minutes: 1 }])
    expect(reports.some(report => report.app === 'Dahlia'), 'her own window is never what they are doing').toBe(false)
  })

  it('keeps going after failures, slowly after several in a row', async () => {
    const { instance, reports, sleeps } = awareness([...repeat(PC_MAX_FAILURES, new Error('No helper.')), code, code])
    await instance.start()
    expect(sleeps.slice(0, PC_MAX_FAILURES)).toEqual([...Array.from<number>({ length: PC_MAX_FAILURES - 1 }).fill(PC_SAMPLE_MS), PC_SLOW_MS])
    expect(reports).toHaveLength(1)
    expect(instance.state.error).toBeUndefined()
  })
})
