// Dahlia: tests for dahlia-pc-state.ts, what the PC tells her PC awareness.
import { describe, expect, it, vi } from 'vitest'

import { createDahliaPcState } from './dahlia-pc-state'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { getFocusedWindow: vi.fn(() => null) }, powerMonitor: { getSystemIdleTime: vi.fn(() => 0) } }))

describe('dahlia pc state', () => {
  it('tells the window in front, the idle time, and the processor\'s share since the last answer', async () => {
    const times = [
      [{ user: 100, nice: 0, sys: 50, idle: 850, irq: 0 }],
      [{ user: 400, nice: 0, sys: 150, idle: 1450, irq: 0 }],
    ]
    let call = 0
    const state = createDahliaPcState({
      foreground: async () => ({ ok: true, hwnd: 7, title: 'Program.cs - nadekobot', process: 'Code' }),
      idleSeconds: () => 4.6,
      ownFocused: () => false,
      cpuTimes: () => times[Math.min(call++, 1)],
      freeMemory: () => 4,
      totalMemory: () => 16,
    })

    expect(await state()).toEqual({ app: 'Code', title: 'Program.cs - nadekobot', own: false, idleSeconds: 5, cpu: undefined, memory: 75, gpu: undefined, volume: undefined, muted: undefined })
    expect((await state()).cpu, '400 of the 1000 new ticks were busy').toBe(40)
  })

  it('still answers without the window helper', async () => {
    const state = createDahliaPcState({
      foreground: async () => ({ ok: false, error: 'The window helper runs only in the Windows app.' }),
      idleSeconds: () => 300,
      ownFocused: () => true,
      cpuTimes: () => [],
      freeMemory: () => 0,
      totalMemory: () => 0,
    })
    expect(await state()).toEqual({ app: '', title: '', own: true, idleSeconds: 300, cpu: undefined, memory: 0, gpu: undefined, volume: undefined, muted: undefined })
  })

  it('adds the sound and the graphics card that the window helper reads, and leaves out what it couldn\'t', async () => {
    const answers = [
      { ok: true as const, volume: 42.4, muted: false, gpu: 130 },
      { ok: true as const, soundError: 'no audio device' },
    ]
    let call = 0
    const state = createDahliaPcState({
      foreground: async () => ({ ok: true, title: '', process: 'Game' }),
      system: async () => answers[call++]!,
      idleSeconds: () => 0,
      ownFocused: () => false,
      cpuTimes: () => [],
      freeMemory: () => 8,
      totalMemory: () => 16,
    })

    expect(await state()).toMatchObject({ gpu: 100, volume: 42, muted: false })
    expect(await state()).toMatchObject({ gpu: undefined, volume: undefined, muted: undefined })
  })
})
