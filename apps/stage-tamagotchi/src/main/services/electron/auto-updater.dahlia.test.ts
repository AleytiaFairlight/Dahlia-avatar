// Dahlia: the desktop updater looks the newest release up again for every check. This file is
// Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh makes the change in auto-updater.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appMock = vi.hoisted(() => ({
  getVersion: vi.fn(() => '0.12.0-beta.5.1'),
  getPath: vi.fn((name: string) => name === 'logs' ? '/tmp/airi/logs' : `/tmp/${name}`),
  quit: vi.fn(),
  isPackaged: true,
}))

const updaterState = vi.hoisted(() => ({
  instance: createUpdaterMock(),
}))

function createUpdaterMock() {
  return {
    on: vi.fn(),
    autoDownload: true,
    allowPrerelease: false,
    channel: undefined as string | undefined,
    logger: undefined as any,
    forceDevUpdateConfig: false,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
  }
}

vi.mock('electron', () => ({
  app: appMock,
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
}))

vi.mock('std-env', () => ({
  isWindows: true,
}))

vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({
    useGlobalConfig: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      withError: () => ({
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }),
  }),
}))

vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      return updaterState.instance
    },
  },
}))

vi.mock('~build/git', () => ({
  committerDate: '2026-10-20T00:00:00.000Z',
}))

const feed = (tag: string) => ({
  provider: 'generic',
  url: `https://github.com/AleytiaFairlight/Dahlia-avatar/releases/download/${tag}`,
})

describe('dahlia desktop updater', () => {
  let releases: Array<{ tag_name: string, draft: boolean, prerelease: boolean }> | Error

  const publish = (...tags: string[]) => {
    releases = tags.map(tag_name => ({ tag_name, draft: false, prerelease: true }))
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    updaterState.instance = createUpdaterMock()
    delete process.env.UPDATE_SERVER_URL
    delete process.env.AIRI_UPDATE_CHANNEL
    publish('v0.12.0-beta.5.1', 'v0.12.0-beta.5')
    // Both the releases API and the releases.atom fallback go through fetch.
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (releases instanceof Error)
        throw releases
      const payload = releases
      return { ok: true, status: 200, statusText: 'OK', json: async () => payload, text: async () => '' }
    }))
  })

  // ROOT CAUSE:
  //
  // The updater looked the newest release up once per session and then kept checking that release's
  // feed. A release published while the app ran stayed "not-available" until the app restarted.
  it('finds a release published while the app runs', async () => {
    const { setupAutoUpdater } = await import('./auto-updater')
    const service = setupAutoUpdater()
    await service.checkForUpdates()
    expect(updaterState.instance.setFeedURL).toHaveBeenLastCalledWith(feed('v0.12.0-beta.5.1'))

    publish('v0.12.0-beta.5.2', 'v0.12.0-beta.5.1', 'v0.12.0-beta.5')
    await service.checkForUpdates()

    expect(updaterState.instance.setFeedURL).toHaveBeenLastCalledWith(feed('v0.12.0-beta.5.2'))
    expect(service.state.status).not.toBe('error')
  })

  it('switches the feed only when the newest release changes', async () => {
    const { setupAutoUpdater } = await import('./auto-updater')
    const service = setupAutoUpdater()
    await service.checkForUpdates()
    await service.checkForUpdates()

    expect(updaterState.instance.setFeedURL).toHaveBeenCalledTimes(1)
    expect(updaterState.instance.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('checks the release found before when a lookup fails', async () => {
    const { setupAutoUpdater } = await import('./auto-updater')
    const service = setupAutoUpdater()
    await service.checkForUpdates()
    const checks = updaterState.instance.checkForUpdates.mock.calls.length

    releases = new Error('getaddrinfo ENOTFOUND api.github.com')
    await service.checkForUpdates()

    expect(service.state.status).not.toBe('error')
    expect(updaterState.instance.checkForUpdates).toHaveBeenCalledTimes(checks + 1)
    expect(updaterState.instance.setFeedURL).toHaveBeenCalledTimes(1)
  })

  it('still fails when no release was ever found', async () => {
    releases = new Error('getaddrinfo ENOTFOUND api.github.com')
    const { setupAutoUpdater } = await import('./auto-updater')
    const service = setupAutoUpdater()

    await service.checkForUpdates()

    expect(service.state.status).toBe('error')
    expect(updaterState.instance.setFeedURL).not.toHaveBeenCalled()
  })
})
