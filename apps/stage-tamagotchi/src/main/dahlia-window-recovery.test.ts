import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (...args: any[]) => void>()
  return {
    listeners,
    app: { on: (event: string, listener: (...args: any[]) => void) => listeners.set(event, listener) },
  }
})

vi.mock('electron', () => ({ app: electron.app }))

const { MAX_RELOADS, RELOAD_DELAY_MS, RELOAD_WINDOW_MS, setupDahliaWindowRecovery, shouldReloadPage } = await import('./dahlia-window-recovery')

function page() {
  return {
    destroyed: false,
    isDestroyed() {
      return this.destroyed
    },
    reload: vi.fn(),
  }
}

describe('dahlia window recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    electron.listeners.clear()
    setupDahliaWindowRecovery()
  })

  afterEach(() => vi.useRealTimers())

  it('reloads a page that crashed', () => {
    const contents = page()
    electron.listeners.get('render-process-gone')!({}, contents, { reason: 'crashed', exitCode: 1 })
    expect(contents.reload).not.toHaveBeenCalled()

    vi.advanceTimersByTime(RELOAD_DELAY_MS)
    expect(contents.reload).toHaveBeenCalledTimes(1)
  })

  it('leaves a page that closed on purpose, or one gone while the app quits', () => {
    const closed = page()
    electron.listeners.get('render-process-gone')!({}, closed, { reason: 'clean-exit', exitCode: 0 })
    electron.listeners.get('before-quit')!()
    const quitting = page()
    electron.listeners.get('render-process-gone')!({}, quitting, { reason: 'killed', exitCode: 9 })

    vi.advanceTimersByTime(RELOAD_DELAY_MS)
    expect(closed.reload).not.toHaveBeenCalled()
    expect(quitting.reload).not.toHaveBeenCalled()
  })

  it('does not reload a window destroyed before the reload', () => {
    const contents = page()
    electron.listeners.get('render-process-gone')!({}, contents, { reason: 'oom', exitCode: 1 })
    contents.destroyed = true

    vi.advanceTimersByTime(RELOAD_DELAY_MS)
    expect(contents.reload).not.toHaveBeenCalled()
  })

  it('stops after MAX_RELOADS in the window, and tries again once they age out', () => {
    const history: number[] = []
    for (let i = 0; i < MAX_RELOADS; i++)
      expect(shouldReloadPage('crashed', history, 1000 + i, false)).toBe(true)

    expect(shouldReloadPage('crashed', history, 2000, false)).toBe(false)
    expect(shouldReloadPage('crashed', history, 1000 + RELOAD_WINDOW_MS + MAX_RELOADS, false)).toBe(true)
  })
})
