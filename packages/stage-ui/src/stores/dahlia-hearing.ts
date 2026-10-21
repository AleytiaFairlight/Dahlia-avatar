// Dahlia: turns voice input on, once. Speech is transcribed on the device by Sherpaw, with the model
// bundled in the app, and only Dahlia's name (the wake word on her card) starts an input. This file is
// Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls it when both apps start.

import { SHERPAW_TRANSCRIPTION_PROVIDER_ID, zipformerEnglishInt8 } from '@proj-airi/provider-inference'

import { useHearingStore } from './modules/hearing'
import { useProviderConfigStore } from './providers/config'
import { useProviderStore } from './providers/provider'
import { useSettingsAudioDevice } from './settings/audio-device'

/** Set once voice input has been turned on, so later changes in the Hearing settings stay. */
export const DAHLIA_HEARING_ENABLED_KEY = 'dahlia/hearing-enabled'

/** Set once the transcription uses the English model, so a later choice in its settings stays. */
export const DAHLIA_ENGLISH_TRANSCRIPTION_KEY = 'dahlia/hearing-english'

/** Sherpaw has one model entry; the recognition model is chosen in its own settings. */
export const DAHLIA_TRANSCRIPTION_MODEL_ID = 'sherpaw'

/**
 * Listens for Dahlia's name and sends what follows it. Runs once per install: after that, the
 * Hearing settings decide.
 */
export async function enableDahliaHearingOnce() {
  await useEnglishTranscriptionOnce()
  if (localStorage.getItem(DAHLIA_HEARING_ENABLED_KEY))
    return

  const hearing = useHearingStore()
  if (!hearing.activeTranscriptionProvider) {
    const providerStore = useProviderStore()
    await providerStore.initializeProvider(SHERPAW_TRANSCRIPTION_PROVIDER_ID)
    await providerStore.forceProviderConfigured(SHERPAW_TRANSCRIPTION_PROVIDER_ID)
    hearing.activeTranscriptionProvider = SHERPAW_TRANSCRIPTION_PROVIDER_ID
    hearing.activeTranscriptionModel = DAHLIA_TRANSCRIPTION_MODEL_ID
  }

  // Only her name starts an input, and a pause ends it. The rephrase and the end judge ask the chat
  // model about every utterance, which takes seconds on Dahlia's server, so they stay off.
  hearing.inputMode = 'wake-word'
  hearing.autoSendEnabled = true
  hearing.rephraseEnabled = false
  hearing.endJudgeEnabled = false

  // Opens the microphone, so the system asks for permission. A refusal turns it off again.
  useSettingsAudioDevice().enabled = true
  localStorage.setItem(DAHLIA_HEARING_ENABLED_KEY, 'true')
}

/**
 * Moves an install to the English speech model, once. The apps bundle only that model now: the
 * bilingual ones they had before wrote some English as Chinese. A new configuration chooses it by
 * itself.
 */
export async function useEnglishTranscriptionOnce() {
  if (localStorage.getItem(DAHLIA_ENGLISH_TRANSCRIPTION_KEY))
    return

  const providerConfig = useProviderConfigStore()
  if (providerConfig.getProvider(SHERPAW_TRANSCRIPTION_PROVIDER_ID))
    await providerConfig.patchProviderConfig(SHERPAW_TRANSCRIPTION_PROVIDER_ID, { model: zipformerEnglishInt8.id, modelLanguageFilter: 'en' })
  localStorage.setItem(DAHLIA_ENGLISH_TRANSCRIPTION_KEY, 'true')
}
