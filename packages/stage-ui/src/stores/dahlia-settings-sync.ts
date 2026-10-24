// Dahlia: starts the settings sync (libs/dahlia-settings-sync.ts) with the voice-checked session. This file is
// Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls it when both apps start.

import { DahliaSettingsSync } from '../libs/dahlia-settings-sync'
import { SERVER_URL } from '../libs/server'
import { dahliaSession } from './dahlia-auth'
import { useDahliaServerMemoryOnce } from './dahlia-memory'
import { useHearingStore } from './modules/hearing'
import { useSpeechStore } from './modules/speech'

/** How often a running app looks for changes from other devices. */
const SYNC_INTERVAL_MS = 60_000
/** Changes made in quick succession go to the server together. */
const SEND_DELAY_MS = 1_500

let started = false

/**
 * Shared settings of stores that ignore storage events (they keep their windows in step themselves), by
 * the store and property that hold them. The sync sets these directly, so a change shows at once.
 */
const storeSettings: Record<string, () => [object, string]> = {
  'settings/hearing/input-mode': () => [useHearingStore(), 'inputMode'],
  'settings/hearing/auto-send-enabled': () => [useHearingStore(), 'autoSendEnabled'],
  'settings/hearing/auto-send-delay': () => [useHearingStore(), 'autoSendDelay'],
  'settings/hearing/confidence-threshold': () => [useHearingStore(), 'confidenceThreshold'],
  'settings/hearing/rephrase-enabled': () => [useHearingStore(), 'rephraseEnabled'],
  'settings/hearing/end-judge-enabled': () => [useHearingStore(), 'endJudgeEnabled'],
  'settings/speech/pitch': () => [useSpeechStore(), 'pitch'],
  'settings/speech/rate': () => [useSpeechStore(), 'rate'],
  'settings/speech/ssml-enabled': () => [useSpeechStore(), 'ssmlEnabled'],
  'settings/speech/voice': () => [useSpeechStore(), 'activeSpeechVoiceId'],
}

/** Reads stored text the way VueUse does for the property's type: booleans, numbers, text or JSON. */
function parseStoredValue(raw: string, current: unknown): unknown {
  switch (typeof current) {
    case 'boolean':
      return raw === 'true'
    case 'number':
      return Number(raw)
    case 'string':
      return raw
    default:
      return JSON.parse(raw)
  }
}

/** Gives a value from another device to the store that holds it, when that store ignores storage events. */
export function applyToStore(key: string, value: string | null) {
  const target = storeSettings[key]
  if (!target || value === null)
    return
  const [store, property] = target()
  const fields = store as Record<string, unknown>
  fields[property] = parseStoredValue(value, fields[property])
}

/** Syncs now, every minute, when the app comes back to the front, and shortly after a change here. */
export function startDahliaSettingsSync() {
  if (started)
    return
  started = true
  // Her memory is on her server now; the apps' own memory goes off once (a shared setting).
  useDahliaServerMemoryOnce()

  const sync = new DahliaSettingsSync({
    serverUrl: SERVER_URL,
    // The settings are each person's own and need the voice-checked session; without one, nothing syncs.
    getKey: () => dahliaSession(),
    onApplied: (key, value) => {
      try {
        applyToStore(key, value)
      }
      catch (error) {
        console.warn(`Dahlia: could not apply the shared setting ${key}`, error)
      }
    },
  })
  const run = () => void sync.sync().catch(error => console.warn('Dahlia: settings sync failed', error))

  let sendTimer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('storage', (event) => {
    if (!sync.noteLocalChange(event))
      return
    clearTimeout(sendTimer)
    sendTimer = setTimeout(run, SEND_DELAY_MS)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
      run()
  })
  setInterval(() => {
    if (document.visibilityState === 'visible')
      run()
  }, SYNC_INTERVAL_MS)
  run()
}
