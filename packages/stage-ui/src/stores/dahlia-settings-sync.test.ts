// Dahlia: tests for stores/dahlia-settings-sync.ts, which gives shared settings to the stores that hold them.
import { describe, expect, it, vi } from 'vitest'

import { applyToStore } from './dahlia-settings-sync'

const { hearing, speech } = vi.hoisted(() => ({
  hearing: { inputMode: 'always-on', autoSendEnabled: true, autoSendDelay: 2000 },
  speech: { pitch: 0, activeSpeechVoiceId: '' },
}))

vi.mock('./modules/hearing', () => ({ useHearingStore: () => hearing }))
vi.mock('./modules/speech', () => ({ useSpeechStore: () => speech }))
vi.mock('./providers/config', () => ({ useProviderConfigStore: () => ({}) }))

describe('dahlia settings sync stores', () => {
  it('sets the store property with the stored type', () => {
    applyToStore('settings/hearing/auto-send-enabled', 'false')
    applyToStore('settings/hearing/auto-send-delay', '3500')
    applyToStore('settings/hearing/input-mode', 'wake-word')
    applyToStore('settings/speech/pitch', '-2')
    applyToStore('settings/speech/voice', 'dahlia')

    expect(hearing).toEqual({ inputMode: 'wake-word', autoSendEnabled: false, autoSendDelay: 3500 })
    expect(speech).toEqual({ pitch: -2, activeSpeechVoiceId: 'dahlia' })
  })

  it('leaves settings that their stores follow from storage, and removals', () => {
    applyToStore('settings/language', '"ja"')
    applyToStore('settings/hearing/input-mode', null)

    expect(hearing.inputMode).toBe('wake-word')
  })
})
