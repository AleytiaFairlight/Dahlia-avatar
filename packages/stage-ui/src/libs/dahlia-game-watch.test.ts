// Dahlia: tests for dahlia-game-watch.ts, Dahlia watching Aleytia play to learn the game.
import type { DahliaGameWatchWindow, DahliaWatchGesture, DahliaWatchSample } from './dahlia-game-watch'

import { describe, expect, it, vi } from 'vitest'

import { DahliaGameWatcher, watchAction, watchSessionId } from './dahlia-game-watch'

/** A game window: each tick shows the next picture (undefined: another window is in front) and the next clicks. */
function setup(pictures: (string | undefined)[], clicks: (now: number) => DahliaWatchGesture[]) {
  let now = 0
  let tick = 0
  const uploads: DahliaWatchSample[] = []
  const window: DahliaGameWatchWindow = {
    find: vi.fn(async () => ({ hwnd: 7, title: 'DarkWar' })),
    peek: vi.fn(async () => {
      const picture = pictures[Math.min(tick, pictures.length - 1)]
      now += 100
      return picture
    }),
    events: vi.fn(async () => clicks(now).splice(0)),
    stop: vi.fn(async () => {}),
  }
  const end = vi.fn(async () => 'Learned 2 things.')
  const watcher = new DahliaGameWatcher({
    window,
    upload: async (sample) => {
      uploads.push(sample)
    },
    end,
    sleep: async (ms) => {
      now += ms
      tick++
    },
    now: () => now,
  })
  return { watcher, window, uploads, end }
}

describe('dahlia game watch', () => {
  it('tells clicks from drags', () => {
    expect(watchAction({ x1: 500, y1: 500, x2: 505, y2: 503, at: 0, ms: 90 })).toEqual({ type: 'tap', x: 500, y: 500 })
    expect(watchAction({ x1: 500, y1: 800, x2: 500, y2: 300, at: 0, ms: 400 })).toEqual({ type: 'swipe', x1: 500, y1: 800, x2: 500, y2: 300, ms: 400 })
  })

  it('names sessions by their start, so they sort', () => {
    expect(watchSessionId(new Date(2026, 10, 2, 15, 30, 12), 0.5)).toBe('20261102-153012-8000')
  })

  it('keeps each click with the screen before it and the screen after it', async () => {
    const pending = [{ x1: 850, y1: 120, x2: 851, y2: 121, at: 1_000, ms: 80 }]
    const { watcher, uploads, end, window } = setup(
      ['data:image/jpeg;base64,b2ZmZXI=', 'data:image/jpeg;base64,b2ZmZXI=', 'data:image/jpeg;base64,YmFzZQ=='],
      now => now >= 1_000 ? pending : [],
    )
    // Stop once the click has gone out.
    window.events = vi.fn(async () => {
      const taken = pending.splice(0)
      if (uploads.length > 0)
        watcher.stop('Stopped when asked.')
      return taken
    })

    await watcher.start({ game: 'dark-war-survival', windowTitle: 'DarkWar', minutes: 5 })

    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({
      game: 'dark-war-survival',
      at: 1_000,
      action: { type: 'tap', x: 850, y: 120 },
      before: 'data:image/jpeg;base64,b2ZmZXI=',
      after: 'data:image/jpeg;base64,YmFzZQ==',
    })
    expect(end).toHaveBeenCalledWith('dark-war-survival', watcher.state.session)
    expect(window.stop).toHaveBeenCalled()
    expect(watcher.state).toMatchObject({ running: false, samples: 1, missed: 0, ended: 'Stopped when asked. 1 clicks kept. Learned 2 things.' })
  })

  it('skips a click it has no picture before, and stops when the time is up', async () => {
    let given = false
    const { watcher, uploads, end } = setup([undefined], () => {
      if (given)
        return []
      given = true
      return [{ x1: 500, y1: 500, x2: 500, y2: 500, at: 50, ms: 80 }]
    })

    await watcher.start({ game: 'dark-war-survival', windowTitle: 'DarkWar', minutes: 1 })

    expect(uploads).toHaveLength(0)
    expect(end).not.toHaveBeenCalled()
    expect(watcher.state).toMatchObject({ running: false, samples: 0, missed: 1, ended: 'Time is up. 0 clicks kept.' })
  })

  it('ends with the reason when the window is not open', async () => {
    const { watcher, window } = setup([], () => [])
    window.find = vi.fn(async () => {
      throw new Error('No game window has "DarkWar" in its title.')
    })

    await watcher.start({ game: 'dark-war-survival', windowTitle: 'DarkWar' })

    expect(watcher.state).toMatchObject({ running: false, ended: 'No game window has "DarkWar" in its title.' })
  })
})
