// Dahlia: triggers the avatar auras from her answers. When her answer carries an emotion that has an aura (the ACT
// signal the stage also turns into a facial expression), her 3D avatar shows it for a few seconds
// (stage-ui-three components/dahlia-auras.ts and DahliaAuras.vue). Auras keep a pause between them, so an answer
// full of emotions doesn't turn into fireworks. Stage.vue starts it (scripts/apply_avatar_branding.sh adds the
// call). An answer's ACT motion that names an animation of her library (stage-ui-three
// components/dahlia-animations.ts) plays it too. This file is Dahlia's (AIRI has no such file).

import { normalizeActPayload } from '@proj-airi/pipelines-audio'
import { sendDahliaAnimationCommand } from '@proj-airi/stage-ui-three/dahlia-animations'
import { dahliaAuraForEmotion, triggerDahliaAura } from '@proj-airi/stage-ui-three/dahlia-auras'

/** At least this long between two auras. */
export const DAHLIA_AURA_PAUSE_MS = 20_000

interface StageSignal { type: string, payload?: unknown }

/** Listens to the answer's signals; answers the function that stops it. */
export function startDahliaAvatarAuras(
  streamingControl: { onSignal: (handler: (signal: StageSignal) => Promise<void>) => () => void },
  options: { now?: () => number, trigger?: typeof triggerDahliaAura, animate?: typeof sendDahliaAnimationCommand } = {},
) {
  let last = Number.NEGATIVE_INFINITY
  return streamingControl.onSignal(async (signal: StageSignal) => {
    if (signal.type !== 'act' || !signal.payload || typeof signal.payload !== 'object')
      return
    const act = normalizeActPayload(signal.payload as Record<string, unknown>)
    // The 3D scene plays it when her library has an animation of that name, and ignores it otherwise.
    if (act.motion)
      (options.animate ?? sendDahliaAnimationCommand)({ op: 'play', name: act.motion })
    const emotion = act.emotion
    const aura = emotion && dahliaAuraForEmotion(emotion.name, emotion.intensity)
    const now = (options.now ?? Date.now)()
    if (!aura || now - last < DAHLIA_AURA_PAUSE_MS)
      return
    if ((options.trigger ?? triggerDahliaAura)(aura.kind, aura.seconds))
      last = now
  })
}
