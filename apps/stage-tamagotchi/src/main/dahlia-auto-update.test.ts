// Dahlia: the desktop app downloads updates at once and installs them while the computer is idle.
// This file is Dahlia's (AIRI has no such file).
import type { AutoUpdaterState } from '@proj-airi/electron-eventa/electron-updater'

import type { AutoUpdater } from './services/electron/auto-updater'

import { describe, expect, it, vi } from 'vitest'

import {
  DAHLIA_UPDATE_CHECK_INTERVAL_MS,
  DAHLIA_UPDATE_IDLE_SECONDS,
  DAHLIA_UPDATE_INSTALL_POLL_MS,
  setupDahliaAutoUpdate,
} from './dahlia-auto-update'

vi.mock('electron', () => ({ powerMonitor: { getSystemIdleTime: () => 0 } }))

function createUpdater(status: AutoUpdaterState['status'] = 'idle') {
  const listeners: ((state: AutoUpdaterState) => void)[] = []
  const updater = {
    state: { status } as AutoUpdaterState,
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn().mockResolvedValue(undefined),
    getPreferredUpdateLane: vi.fn(),
    setPreferredUpdateLane: vi.fn(),
    subscribe: vi.fn((callback: (state: AutoUpdaterState) => void) => {
      listeners.push(callback)
      return () => listeners.splice(listeners.indexOf(callback), 1)
    }),
  }
  const emit = (state: AutoUpdaterState) => {
    updater.state = state
    listeners.forEach(listener => listener(state))
  }
  return { updater: updater as AutoUpdater & typeof updater, emit, listeners }
}

function createDeps(idle = 0) {
  const timers = new Map<number, () => void>()
  const deps = {
    idle,
    idleSeconds: () => deps.idle,
    setInterval: vi.fn((callback: () => void, ms: number) => {
      timers.set(ms, callback)
      return ms
    }),
    clearInterval: vi.fn((timer: unknown) => timers.delete(timer as number)),
    tick: (ms: number) => timers.get(ms)?.(),
    timers,
  }
  return deps
}

describe('setupDahliaAutoUpdate', () => {
  it('downloads a release as soon as it is found', () => {
    const { updater, emit } = createUpdater()
    setupDahliaAutoUpdate(updater, createDeps())

    emit({ status: 'available', info: { version: '0.12.0-beta.5.19', files: [], releaseDate: '' } })

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('downloads a release that was found before it started', () => {
    const { updater } = createUpdater('available')
    setupDahliaAutoUpdate(updater, createDeps())

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('checks every hour, but not while an update waits to be installed', () => {
    const { updater, emit } = createUpdater()
    const deps = createDeps()
    setupDahliaAutoUpdate(updater, deps)

    deps.tick(DAHLIA_UPDATE_CHECK_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    emit({ status: 'downloaded' })
    deps.tick(DAHLIA_UPDATE_CHECK_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('installs a downloaded update only once the computer is idle, and only once', () => {
    const { updater, emit } = createUpdater()
    const deps = createDeps(DAHLIA_UPDATE_IDLE_SECONDS - 1)
    setupDahliaAutoUpdate(updater, deps)

    deps.tick(DAHLIA_UPDATE_INSTALL_POLL_MS)
    emit({ status: 'downloaded' })
    deps.tick(DAHLIA_UPDATE_INSTALL_POLL_MS)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    deps.idle = DAHLIA_UPDATE_IDLE_SECONDS
    deps.tick(DAHLIA_UPDATE_INSTALL_POLL_MS)
    deps.tick(DAHLIA_UPDATE_INSTALL_POLL_MS)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does nothing when updates are off, and stops when asked', () => {
    const off = createUpdater('disabled')
    const offDeps = createDeps()
    setupDahliaAutoUpdate(off.updater, offDeps)
    expect(off.updater.subscribe).not.toHaveBeenCalled()
    expect(offDeps.timers.size).toBe(0)

    const { updater, listeners } = createUpdater()
    const deps = createDeps()
    const stop = setupDahliaAutoUpdate(updater, deps)
    stop()
    expect(listeners).toHaveLength(0)
    expect(deps.timers.size).toBe(0)
  })
})
