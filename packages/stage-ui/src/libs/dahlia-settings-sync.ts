// Dahlia: keeps the apps' preferences the same on every device. Dahlia's server stores the shared
// settings (/api/v1/dahlia/settings, with the Dahlia key); each app sends its changes and applies the
// others'. This file is Dahlia's (AIRI has no such file); stores/dahlia-settings-sync.ts starts it.

/** The settings API on Dahlia's server. */
export const SETTINGS_SYNC_PATH = '/api/v1/dahlia/settings'

/** When this device last changed or received each shared setting. */
export const SETTINGS_SYNC_META_KEY = 'dahlia/settings-sync'

/**
 * Preferences that follow the user from device to device. Settings of the device itself stay local:
 * microphone, volume and mute, windows, the Dahlia key and other tokens, and the transcription model,
 * because each app bundles its own.
 */
export const SYNCED_SETTING_KEYS: readonly string[] = [
  'settings/language',
  'settings/theme/colors/hue',
  'settings/theme/colors/hue-dynamic',
  'settings/disable-transitions',
  'settings/use-page-specific-transitions',
  'settings/streamer-mode',
  'settings/stickers/enabled',
  'settings/stickers/frequency',
  'settings/hearing/input-mode',
  'settings/hearing/auto-send-enabled',
  'settings/hearing/auto-send-delay',
  'settings/hearing/confidence-threshold',
  'settings/hearing/rephrase-enabled',
  'settings/hearing/end-judge-enabled',
  'settings/speech/pitch',
  'settings/speech/rate',
  'settings/speech/ssml-enabled',
  'settings/speech/voice',
  'settings/live2d/magic/profile',
  'settings/live2d/magic/skip-mouth-open',
  'settings/live2d/magic/force-view-target',
  'ui/chat/settings/send-mode',
  'ui/chat/voice-mode',
  'memory/enabled',
  'recipes/proposals-enabled',
]

/** A shared setting: its stored text (null when removed) and when it last changed. */
export interface SyncedSetting {
  value: string | null
  updatedAt: number
}

export type SyncedSettings = Record<string, SyncedSetting>

export interface SettingsSyncOptions {
  serverUrl: string
  /** The Dahlia key, or undefined before the app is set up. */
  getKey: () => string | undefined
  storage?: Storage
  target?: EventTarget
  fetcher?: typeof fetch
  now?: () => number
  /** Called after a value from another device is written, for stores that do not follow storage events. */
  onApplied?: (key: string, value: string | null) => void
}

/**
 * Two-way sync of {@link SYNCED_SETTING_KEYS}. For each setting the newest change wins. On a device's
 * first sync, settings the server already has win, and the device sends the ones it lacks.
 */
export class DahliaSettingsSync {
  private readonly storage: Storage
  private readonly target: EventTarget
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private applying = false
  private running: Promise<void> | undefined
  private pending = false

  constructor(private readonly options: SettingsSyncOptions) {
    this.storage = options.storage ?? globalThis.localStorage
    this.target = options.target ?? globalThis.window
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.now = options.now ?? Date.now
  }

  /**
   * Notes a change that this window made. The settings stores write through VueUse, which tells its
   * own window with an untrusted storage event; other windows get trusted ones, and their writer
   * sends the change. Changes this sync applies are not sent back.
   */
  noteLocalChange(event: StorageEvent): boolean {
    if (this.applying || event.isTrusted || !event.key || !SYNCED_SETTING_KEYS.includes(event.key))
      return false
    const meta = this.readMeta()
    meta[event.key] = this.now()
    this.writeMeta(meta)
    return true
  }

  /** Exchanges changes with the server. Calls made while one runs are merged into one more run. */
  async sync(): Promise<void> {
    if (this.running) {
      this.pending = true
      return this.running
    }
    this.running = this.syncInternal().finally(() => {
      this.running = undefined
      if (this.pending) {
        this.pending = false
        void this.sync()
      }
    })
    return this.running
  }

  private async syncInternal() {
    const key = this.options.getKey()
    if (!key)
      return

    const url = new URL(SETTINGS_SYNC_PATH, this.options.serverUrl).href
    const headers = { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
    const response = await this.fetcher(url, { headers })
    if (!response.ok)
      return
    const remote = ((await response.json()) as { settings?: SyncedSettings }).settings ?? {}

    const meta = this.readMeta()
    const outgoing: SyncedSettings = {}
    for (const settingKey of SYNCED_SETTING_KEYS) {
      const local = meta[settingKey]
      const server = remote[settingKey]
      if (server && (local === undefined || server.updatedAt > local)) {
        this.apply(settingKey, server.value)
        meta[settingKey] = server.updatedAt
      }
      else if (local !== undefined && (!server || local > server.updatedAt)) {
        outgoing[settingKey] = { value: this.storage.getItem(settingKey), updatedAt: local }
      }
      else if (local === undefined && !server && this.storage.getItem(settingKey) !== null) {
        const updatedAt = this.now()
        outgoing[settingKey] = { value: this.storage.getItem(settingKey), updatedAt }
        meta[settingKey] = updatedAt
      }
    }
    this.writeMeta(meta)

    if (Object.keys(outgoing).length > 0)
      await this.fetcher(url, { method: 'POST', headers, body: JSON.stringify({ settings: outgoing }) })
  }

  /**
   * Writes a value from another device and tells this window's settings stores. Stores that ignore
   * storage events get the value through `onApplied`.
   */
  private apply(key: string, value: string | null) {
    const oldValue = this.storage.getItem(key)
    if (oldValue === value)
      return
    this.applying = true
    try {
      if (value === null)
        this.storage.removeItem(key)
      else
        this.storage.setItem(key, value)
      this.target.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: value, storageArea: this.storage }))
      this.options.onApplied?.(key, value)
    }
    finally {
      this.applying = false
    }
  }

  private readMeta(): Record<string, number> {
    try {
      return JSON.parse(this.storage.getItem(SETTINGS_SYNC_META_KEY) ?? '{}') as Record<string, number>
    }
    catch {
      return {}
    }
  }

  private writeMeta(meta: Record<string, number>) {
    this.storage.setItem(SETTINGS_SYNC_META_KEY, JSON.stringify(meta))
  }
}
