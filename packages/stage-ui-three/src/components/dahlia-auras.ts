// Dahlia: the avatar auras' triggers. A strong emotion in Dahlia's answer shows for a few seconds as an aura around
// her 3D avatar: fire when she is angry, sparks when she is surprised, an arcane glow when she is curious or
// thinking, and leaves and light when she is happy. stage-ui's libs/dahlia-avatar-auras.ts triggers them from her
// answer's emotions; components/DahliaAuras.vue, inside the 3D scene, shows them with the effects code in ../vfx
// (from dasilva333/airi, MIT). This file is Dahlia's (AIRI has no such file).

export type DahliaAuraKind = 'fire' | 'electric' | 'magic' | 'verdant'

/** An emotion weaker than this shows no aura, so they stay special. */
export const DAHLIA_AURA_MIN_INTENSITY = 0.7
/** How long an aura stays, by how strong the emotion is. */
export const DAHLIA_AURA_SECONDS = 4
export const DAHLIA_AURA_MAX_SECONDS = 6
/** "false" when the person turned the auras off (Settings > Dahlia); on otherwise. */
export const DAHLIA_AURAS_KEY = 'dahlia/avatar-auras'

const AURA_OF_EMOTION: Record<string, DahliaAuraKind> = {
  angry: 'fire',
  surprised: 'electric',
  curious: 'magic',
  think: 'magic',
  happy: 'verdant',
}

/** The aura of an emotion of the given strength (0-1), or undefined when it shows none. */
export function dahliaAuraForEmotion(emotion: string, intensity = 1): { kind: DahliaAuraKind, seconds: number } | undefined {
  const kind = AURA_OF_EMOTION[emotion.toLowerCase()]
  if (!kind || !(intensity >= DAHLIA_AURA_MIN_INTENSITY))
    return undefined
  return { kind, seconds: Math.min(DAHLIA_AURA_MAX_SECONDS, DAHLIA_AURA_SECONDS * Math.min(1.5, intensity / DAHLIA_AURA_MIN_INTENSITY)) }
}

export function dahliaAurasEnabled() {
  try {
    return localStorage.getItem(DAHLIA_AURAS_KEY) !== 'false'
  }
  catch {
    return true
  }
}

type Listener = (kind: DahliaAuraKind, seconds: number) => void
const listeners = new Set<Listener>()

/** The scenes that show auras listen here; answers the function that stops listening. */
export function onDahliaAura(listener: Listener) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Shows an aura on every 3D avatar on screen, unless the person turned them off. */
export function triggerDahliaAura(kind: DahliaAuraKind, seconds = DAHLIA_AURA_SECONDS) {
  if (!dahliaAurasEnabled())
    return false
  for (const listener of listeners)
    listener(kind, seconds)
  return listeners.size > 0
}
