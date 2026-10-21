// Dahlia: the desktop updater looks the newest release up again for every check, and downloads it from
// Dahlia's server when the server has a copy. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh makes the changes in auto-updater.ts.
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

function feed(tag: string) {
  return {
    provider: 'generic',
    url: `https://github.com/AleytiaFairlight/Dahlia-avatar/releases/download/${tag}`,
  }
}

const SERVER = 'https://dahlia.aleytia.moe/api/v1/dahlia/releases'

function serverFeed(tag: string) {
  return {
    provider: 'generic',
    url: `https://dahlia.aleytia.moe/api/v1/dahlia/releases/download/${tag}`,
  }
}

interface Release { tag_name: string, draft: boolean, prerelease: boolean, assets?: { name: string, browser_download_url: string }[] }

describe('dahlia desktop updater', () => {
  let releases: Release[] | Error
  // What Dahlia's server lists; undefined answers 404, as a server without the release list does.
  let server: Release[] | Error | undefined

  const publish = (...tags: string[]) => {
    releases = tags.map(tag_name => ({ tag_name, draft: false, prerelease: true }))
  }

  // The server lists GitHub's releases; the copied ones download from the server.
  const serve = (copied: string[] = []) => {
    server = (releases as Release[]).map(release => copied.includes(release.tag_name)
      ? { ...release, assets: [{ name: 'latest-x64.yml', browser_download_url: `/api/v1/dahlia/releases/download/${release.tag_name}/latest-x64.yml` }] }
      : release)
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    updaterState.instance = createUpdaterMock()
    delete process.env.UPDATE_SERVER_URL
    delete process.env.AIRI_UPDATE_CHANNEL
    publish('v0.12.0-beta.5.1', 'v0.12.0-beta.5')
    server = undefined
    // Dahlia's server, the releases API and the releases.atom fallback all go through fetch.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const answer = url === SERVER ? server : releases
      if (answer instanceof Error)
        throw answer
      if (answer === undefined)
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}), text: async () => '' }
      return { ok: true, status: 200, statusText: 'OK', json: async () => answer, text: async () => '' }
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

  it('downloads from Dahlia\'s server when it has a copy of the release', async () => {
    publish('v0.12.0-beta.5.4', 'v0.12.0-beta.5.3')
    serve(['v0.12.0-beta.5.4'])
    const { setupAutoUpdater } = await import('./auto-updater')
    const service = setupAutoUpdater()

    await service.checkForUpdates()

    expect(updaterState.instance.setFeedURL).toHaveBeenLastCalledWith(serverFeed('v0.12.0-beta.5.4'))
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('api.github.com'), expect.anything())
  })

  it('switches to the server once its copy is complete', async () => {
    publish('v0.12.0-beta.5.4', 'v0.12.0-beta.5.3')
    serve(['v0.12.0-beta.5.3'])
    const { setupAutoUpdater } = await import('./auto-updater')
    const service = setupAutoUpdater()
    await service.checkForUpdates()
    expect(updaterState.instance.setFeedURL).toHaveBeenLastCalledWith(feed('v0.12.0-beta.5.4'))

    serve(['v0.12.0-beta.5.4'])
    await service.checkForUpdates()

    expect(updaterState.instance.setFeedURL).toHaveBeenLastCalledWith(serverFeed('v0.12.0-beta.5.4'))
  })

  it('asks GitHub when Dahlia\'s server doesn\'t answer', async () => {
    publish('v0.12.0-beta.5.4')
    server = new Error('getaddrinfo ENOTFOUND dahlia.aleytia.moe')
    const { setupAutoUpdater } = await import('./auto-updater')
    const service = setupAutoUpdater()

    await service.checkForUpdates()

    expect(updaterState.instance.setFeedURL).toHaveBeenLastCalledWith(feed('v0.12.0-beta.5.4'))
    expect(service.state.status).not.toBe('error')
  })
})
