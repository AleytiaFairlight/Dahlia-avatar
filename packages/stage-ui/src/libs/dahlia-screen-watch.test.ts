import { describe, expect, it, vi } from 'vitest'

import { DahliaScreenWatcher, SCREEN_WATCH_MAX_FAILURES, SCREEN_WATCH_REFRESH_MS } from './dahlia-screen-watch'

function watcher(frames: string[], overrides: Partial<ConstructorParameters<typeof DahliaScreenWatcher>[0]> = {}) {
  let clock = 0
  let frame = 0
  const looks: string[] = []
  const stop = vi.fn(async () => {})
  const instance = new DahliaScreenWatcher({
    capture: async () => {
      const signature = frames[Math.min(frame++, frames.length - 1)]
      return { image: `data:image/jpeg;base64,${signature}`, signature, source: 'Screen 1' }
    },
    look: async (capture) => {
      looks.push(capture.signature)
      return `note of ${capture.signature}`
    },
    stop,
    changed: (before, after) => before !== after,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    ...overrides,
  })
  return { instance, looks, stop }
}

describe('dahlia screen watch', () => {
  it('notes the screen when it changed, skips the same screen, and tells the server when the time is over', async () => {
    const { instance, looks, stop } = watcher(['a', 'a', 'b', 'b'])
    await instance.start({ seconds: 60, minutes: 3 })

    expect(looks).toEqual(['a', 'b'])
    expect(instance.state).toMatchObject({ running: false, looks: 2, skipped: 1, lastSummary: 'note of b', source: 'Screen 1', ended: 'The time to watch is over.' })
    expect(stop).toHaveBeenCalledOnce()
  })

  it('notes an unchanged screen again before her note gets too old', async () => {
    const { instance, looks } = watcher(['a'])
    await instance.start({ seconds: SCREEN_WATCH_REFRESH_MS / 1000, minutes: 9 })
    expect(looks).toEqual(['a', 'a', 'a'])
  })

  it('counts a busy model as not seen and stops after failures in a row', async () => {
    const answers: Array<string | undefined> = [undefined, 'seen']
    const busy = watcher(['a', 'a'], { look: async () => answers.shift() })
    await busy.instance.start({ seconds: 60, minutes: 2 })
    expect(busy.instance.state).toMatchObject({ looks: 1, skipped: 0, lastSummary: 'seen' })

    const failing = watcher(['a'], {
      capture: async () => {
        throw new Error('No screen to capture.')
      },
    })
    await failing.instance.start({ seconds: 20, minutes: 60 })
    expect(failing.instance.state).toMatchObject({ running: false, ended: 'Stopped: No screen to capture.' })
    expect(failing.stop).toHaveBeenCalledOnce()
    expect(SCREEN_WATCH_MAX_FAILURES).toBe(5)
  })

  it('runs until stopped when no time is given, every 15 seconds, or every second for a game', async () => {
    let captures = 0
    const { instance, stop } = watcher(['a'], {
      capture: async () => {
        if (++captures === 50)
          void instance.stop()
        return { image: 'data:image/jpeg;base64,a', signature: 'a', source: 'Screen 1' }
      },
    })
    await instance.start()
    expect(instance.state).toMatchObject({ running: false, endsAt: undefined, seconds: 15, game: false, ended: 'Stopped when asked.' })
    expect(captures).toBe(50)
    expect(stop).toHaveBeenCalledOnce()

    const game = watcher(['a', 'b'])
    void game.instance.start({ game: true, minutes: 1 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(game.instance.state).toMatchObject({ seconds: 1, game: true })
  })
})
