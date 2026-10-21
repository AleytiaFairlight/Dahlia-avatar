// Dahlia: tests for dahlia-hearing.ts and dahlia-wake-word.ts, the apps' voice input.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import vocabulary from '../libs/voice/kws-vocabulary.json'

import { dahliaWakeWords } from '../libs/voice/dahlia-wake-word'
import { kwsModel } from '../libs/voice/kws-model-info'
import { validateWakeWords } from '../libs/voice/wake-words'
import { DAHLIA_HEARING_ENABLED_KEY, DAHLIA_TRANSCRIPTION_MODEL_ID, enableDahliaHearingOnce } from './dahlia-hearing'

const { hearing, audio, providers } = vi.hoisted(() => ({
  hearing: {
    activeTranscriptionProvider: '',
    activeTranscriptionModel: '',
    inputMode: 'always-on',
    autoSendEnabled: false,
    rephraseEnabled: true,
    endJudgeEnabled: true,
  },
  audio: { enabled: false },
  providers: {
    initializeProvider: vi.fn(async () => {}),
    forceProviderConfigured: vi.fn(async () => {}),
  },
}))

vi.mock('./modules/hearing', () => ({ useHearingStore: () => hearing }))
vi.mock('./settings/audio-device', () => ({ useSettingsAudioDevice: () => audio }))
vi.mock('./providers/provider', () => ({ useProviderStore: () => providers }))

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
})

describe('dahlia voice input', () => {
  beforeEach(() => {
    storage.clear()
    Object.assign(hearing, {
      activeTranscriptionProvider: '',
      activeTranscriptionModel: '',
      inputMode: 'always-on',
      autoSendEnabled: false,
      rephraseEnabled: true,
      endJudgeEnabled: true,
    })
    audio.enabled = false
    providers.initializeProvider.mockClear()
    providers.forceProviderConfigured.mockClear()
  })

  it('her name is a valid wake word for the bundled wake word model', () => {
    const model = { id: kwsModel.id, vocabulary: new Set(vocabulary.filter(token => !/^<.+>$/.test(token))) }

    expect(validateWakeWords(dahliaWakeWords, model)).toEqual(dahliaWakeWords)
    expect(dahliaWakeWords[0].text).toBe('Dahlia')
  })

  it('listens for her name with on-device transcription, once', async () => {
    await enableDahliaHearingOnce()

    expect(providers.initializeProvider).toHaveBeenCalledWith('sherpaw-transcription')
    expect(hearing).toMatchObject({
      activeTranscriptionProvider: 'sherpaw-transcription',
      activeTranscriptionModel: DAHLIA_TRANSCRIPTION_MODEL_ID,
      inputMode: 'wake-word',
      autoSendEnabled: true,
      rephraseEnabled: false,
      endJudgeEnabled: false,
    })
    expect(audio.enabled).toBe(true)
    expect(storage.get(DAHLIA_HEARING_ENABLED_KEY)).toBe('true')

    // Later changes in the Hearing settings stay.
    hearing.inputMode = 'push-to-talk'
    audio.enabled = false
    await enableDahliaHearingOnce()
    expect(hearing.inputMode).toBe('push-to-talk')
    expect(audio.enabled).toBe(false)
  })

  it('keeps a transcription provider that was already chosen', async () => {
    hearing.activeTranscriptionProvider = 'other-transcription'
    hearing.activeTranscriptionModel = 'other-model'

    await enableDahliaHearingOnce()

    expect(providers.initializeProvider).not.toHaveBeenCalled()
    expect(hearing.activeTranscriptionProvider).toBe('other-transcription')
    expect(hearing.inputMode).toBe('wake-word')
  })
})
