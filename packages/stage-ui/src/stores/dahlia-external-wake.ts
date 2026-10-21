// Dahlia: starts a voice input as if she had heard her name, for wakes that come from outside the web
// app: Android opening her as the phone's assistant, or her background listening hearing "Dahlia". This
// file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh wraps the wake word
// detection of stores/voice.ts with withDahliaExternalWake().

import type { VoiceActivityOptions } from '../libs/voice/voice-activity-plugin'

import { useAiriCardStore } from './modules/airi-card'

type DetectWakeWord = NonNullable<VoiceActivityOptions['detectWakeWord']>
type WakeTarget = Awaited<ReturnType<DetectWakeWord>>

/**
 * How long a wake waits for the microphone. Opening the app from the background loads the speech
 * models first, which takes a few seconds on a phone.
 */
export const DAHLIA_EXTERNAL_WAKE_MS = 30_000

let pendingUntil = 0

/** Starts an input at the next audio window, as her name would. */
export function requestDahliaWake(now = Date.now()) {
  pendingUntil = now + DAHLIA_EXTERNAL_WAKE_MS
}

/** Whether a wake waits for the microphone. */
export function hasPendingDahliaWake(now = Date.now()) {
  return pendingUntil > now
}

/**
 * Wraps the wake word detection: a requested wake answers the next audio window with the active
 * character's session, and the detection answers all others.
 */
export function withDahliaExternalWake(
  detect: DetectWakeWord | undefined,
  resolveTarget: (characterId: string, signal: AbortSignal) => Promise<WakeTarget>,
  activeCharacterId: () => string | undefined = () => useAiriCardStore().activeCardId,
): DetectWakeWord {
  return async (window, signal, activity) => {
    if (hasPendingDahliaWake()) {
      const characterId = activeCharacterId()
      if (characterId) {
        pendingUntil = 0
        return resolveTarget(characterId, signal)
      }
    }
    return detect?.(window, signal, activity)
  }
}
