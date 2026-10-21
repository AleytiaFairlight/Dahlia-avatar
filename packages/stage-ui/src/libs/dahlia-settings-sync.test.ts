// @vitest-environment jsdom
// Dahlia: tests for dahlia-settings-sync.ts, which shares the apps' preferences between devices.
import { describe, expect, it } from 'vitest'

import { DahliaSettingsSync, SETTINGS_SYNC_META_KEY } from './dahlia-settings-sync'

/** Dahlia's settings API in memory: each setting keeps its newest change. */
function createServer() {
  const settings: Record<string, { value: string | null, updatedAt: number }> = {}
  const fetcher = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { settings: typeof settings }
      for (const [key, setting] of Object.entries(body.settings)) {
        if (!settings[key] || settings[key].updatedAt < setting.updatedAt)
          settings[key] = setting
      }
    }
    return new Response(JSON.stringify({ settings }), { status: 200 })
  }) as typeof fetch
  return { settings, fetcher }
}

// StorageEvent takes only a real Storage. jsdom has two, so each test device gets one.
const storages = [globalThis.localStorage, globalThis.sessionStorage]

function createDevice(server: ReturnType<typeof createServer>, clock: { now: number }, key: string | null = 'dahlia-key', index = 0) {
  const storage = storages[index]
  storage.clear()
  const target = new EventTarget()
  const seen: StorageEvent[] = []
  const sync = new DahliaSettingsSync({ serverUrl: 'https://dahlia.test', getKey: () => key ?? undefined, storage, target, fetcher: server.fetcher, now: () => clock.now })
  const noted: boolean[] = []
  // Like the app: the window's storage listener asks the sync about every event, as it happens.
  target.addEventListener('storage', (event) => {
    seen.push(event as StorageEvent)
    noted.push(sync.noteLocalChange(event as StorageEvent))
  })
  /** A settings store writing through VueUse, which tells its own window with an untrusted event. */
  const write = (settingKey: string, value: string) => {
    const oldValue = storage.getItem(settingKey)
    storage.setItem(settingKey, value)
    sync.noteLocalChange(new StorageEvent('storage', { key: settingKey, oldValue, newValue: value, storageArea: storage }))
  }
  return { storage, sync, seen, noted, write }
}

describe('dahlia settings sync', () => {
  it('applies a change on the desktop to the phone, and back', async () => {
    const server = createServer()
    const clock = { now: 1000 }
    const desktop = createDevice(server, clock)
    const phone = createDevice(server, clock, 'dahlia-key', 1)

    clock.now = 2000
    desktop.write('settings/language', '"ja"')
    await desktop.sync.sync()
    await phone.sync.sync()
    expect(phone.storage.getItem('settings/language')).toBe('"ja"')
    // The phone's settings stores hear about it and update.
    expect(phone.seen.map(event => [event.key, event.newValue])).toEqual([['settings/language', '"ja"']])

    clock.now = 3000
    phone.write('settings/language', '"en"')
    await phone.sync.sync()
    await desktop.sync.sync()
    expect(desktop.storage.getItem('settings/language')).toBe('"en"')
  })

  it('keeps device settings and tokens on the device', async () => {
    const server = createServer()
    const device = createDevice(server, { now: 5 })

    device.write('settings/audio/input', '"usb-mic"')
    device.write('settings/speech/output-volume', '0.2')
    device.write('settings/web-search/api-key', '"secret"')
    device.storage.setItem('settings/hearing/input-mode', '"wake-word"')
    await device.sync.sync()

    expect(Object.keys(server.settings)).toEqual(['settings/hearing/input-mode'])
  })

  it('on a first sync, the server wins and missing settings are sent', async () => {
    const server = createServer()
    server.settings['settings/theme/colors/hue'] = { value: '220', updatedAt: 50 }
    const phone = createDevice(server, { now: 100 })
    phone.storage.setItem('settings/theme/colors/hue', '10')
    phone.storage.setItem('ui/chat/voice-mode', 'true')

    await phone.sync.sync()

    expect(phone.storage.getItem('settings/theme/colors/hue')).toBe('220')
    expect(server.settings['ui/chat/voice-mode']).toEqual({ value: 'true', updatedAt: 100 })
  })

  it('does not send back what it applied, or changes from other windows', async () => {
    const server = createServer()
    server.settings['settings/language'] = { value: '"fr"', updatedAt: 10 }
    const device = createDevice(server, { now: 20 })

    await device.sync.sync()
    expect(device.seen).toHaveLength(1)
    expect(device.noted).toEqual([false])
    // A change from another window comes as a trusted event, which jsdom cannot make; its writer sends it.
    expect(JSON.parse(device.storage.getItem(SETTINGS_SYNC_META_KEY)!)).toEqual({ 'settings/language': 10 })
  })

  it('waits for the Dahlia key', async () => {
    const server = createServer()
    const device = createDevice(server, { now: 1 }, null)
    device.storage.setItem('settings/language', '"en"')

    await device.sync.sync()

    expect(server.settings).toEqual({})
  })
})
