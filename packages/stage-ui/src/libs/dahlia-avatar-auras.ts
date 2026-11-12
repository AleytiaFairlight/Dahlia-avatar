// Dahlia: triggers the avatar auras from her answers. When her answer carries an emotion that has an aura (the ACT
// signal the stage also turns into a facial expression), her 3D avatar shows it for a few seconds
// (stage-ui-three components/dahlia-auras.ts and DahliaAuras.vue). Auras keep a pause between them, so an answer
// full of emotions doesn't turn into fireworks. Stage.vue starts it (scripts/apply_avatar_branding.sh adds the
// call). This file is Dahlia's (AIRI has no such file).

import { normalizeActPayload } from '@proj-airi/pipelines-audio'
import { dahliaAuraForEmotion, triggerDahliaAura } from '@proj-airi/stage-ui-three/dahlia-auras'

/** At least this long between two auras. */
export const DAHLIA_AURA_PAUSE_MS = 20_000

interface StageSignal { type: string, payload?: unknown }

/** Listens to the answer's signals; answers the function that stops it. */
export function startDahliaAvatarAuras(
  streamingControl: { onSignal: (handler: (signal: StageSignal) => Promise<void>) => () => void },
  options: { now?: () => number, trigger?: typeof triggerDahliaAura } = {},
) {
  let last = Number.NEGATIVE_INFINITY
  return streamingControl.onSignal(async (signal: StageSignal) => {
    if (signal.type !== 'act' || !signal.payload || typeof signal.payload !== 'object')
      return
    const emotion = normalizeActPayload(signal.payload as Record<string, unknown>).emotion
    const aura = emotion && dahliaAuraForEmotion(emotion.name, emotion.intensity)
    const now = (options.now ?? Date.now)()
    if (!aura || now - last < DAHLIA_AURA_PAUSE_MS)
      return
    if ((options.trigger ?? triggerDahliaAura)(aura.kind, aura.seconds))
      last = now
  })
}
