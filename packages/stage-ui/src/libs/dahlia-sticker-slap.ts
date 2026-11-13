// Dahlia: stickers on the desktop. The chat already shows a sticker she sends with an answer (Settings > Modules >
// Stickers). Now the same sticker is also slapped onto her stage, beside her avatar: it lands with a little
// bounce at a slight angle and peels off after a few seconds. She can also slap one on her own (her
// avatar_sticker tool on the PC). The idea is the desktop "slappers" of dasilva333/airi; the code is Dahlia's.
// components/scenes/DahliaStickerSlaps.vue shows them; Stage.vue places it and listens for her stickers
// (scripts/apply_avatar_branding.sh adds both). This file is Dahlia's (AIRI has no such file).

/** "false" when the person turned desktop stickers off (Settings > Dahlia); on otherwise. */
export const DAHLIA_DESKTOP_STICKERS_KEY = 'dahlia/desktop-stickers'
/** How long a sticker stays on the stage. */
export const STICKER_SLAP_MS = 6000
/** At most this many at once; a new one takes the oldest one's place. */
export const STICKER_SLAPS_MAX = 3

export interface DahliaStickerSlap {
  key: number
  stickerId: string
  /** Where its middle is, in percent of the stage, and how it is turned, in degrees. */
  left: number
  top: number
  turn: number
}

/** The sticker a marker of her answer names: "<|STICKER airi-happy|>" is "airi-happy". */
export function stickerOfSpecial(special: string) {
  return /^<\|STICKER ([a-z0-9-]+)\|>$/.exec(special.trim())?.[1]
}

/**
 * Where a sticker lands: beside her, not on her. The stage's middle third is hers, so stickers go to the left or
 * the right of it, alternating, in the upper two thirds, at a slight angle.
 */
export function placeStickerSlap(index: number, random: () => number = Math.random) {
  const right = index % 2 === 0
  return {
    left: Math.round(right ? 74 + random() * 14 : 12 + random() * 14),
    top: Math.round(18 + random() * 40),
    turn: Math.round((random() - 0.5) * 28),
  }
}

export function dahliaDesktopStickersEnabled() {
  try {
    return localStorage.getItem(DAHLIA_DESKTOP_STICKERS_KEY) !== 'false'
  }
  catch {
    return true
  }
}

type Listener = (stickerId: string) => void
const listeners = new Set<Listener>()

/** The stages that show slapped stickers listen here; answers the function that stops listening. */
export function onDahliaStickerSlap(listener: Listener) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Slaps a sticker onto every stage in this window, unless the person turned that off. */
export function slapDahliaSticker(stickerId: string) {
  if (!dahliaDesktopStickersEnabled())
    return false
  for (const listener of listeners)
    listener(stickerId)
  return listeners.size > 0
}

/** Listens for the sticker markers of her answers; answers the function that stops it. */
export function startDahliaStickerSlaps<Context>(onTokenSpecial: (callback: (special: string, context: Context) => Promise<void>) => () => void) {
  return onTokenSpecial(async (special) => {
    const stickerId = stickerOfSpecial(special)
    if (stickerId)
      slapDahliaSticker(stickerId)
  })
}
