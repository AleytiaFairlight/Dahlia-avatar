// Dahlia: her chat bubble takes the color of the first emotion of her reply (core-agent records it as
// `message.emotion` from the reply's ACT marker), after the mood bubbles of dasilva333/airi. This file is Dahlia's.

/** Settings > Dahlia switch; on unless turned off. */
export const DAHLIA_MOOD_BUBBLES_KEY = 'dahlia/mood-bubbles'

/** Colors with alpha, so the bubble's own background shows through in light and dark mode. */
const MOOD_TINTS: Record<string, { edge: string, wash: string }> = {
  happy: { edge: '#10b981', wash: '#10b9811a' },
  sad: { edge: '#3b82f6', wash: '#3b82f61a' },
  angry: { edge: '#f43f5e', wash: '#f43f5e1a' },
  surprised: { edge: '#a855f7', wash: '#a855f71f' },
  think: { edge: '#f59e0b', wash: '#f59e0b14' },
  curious: { edge: '#f59e0b', wash: '#f59e0b14' },
  question: { edge: '#f59e0b', wash: '#f59e0b14' },
  awkward: { edge: '#f472b6', wash: '#f472b61a' },
}

/** The style that tints a bubble for this emotion, or nothing for no or an unknown emotion. */
export function dahliaMoodBubbleStyle(emotion: string | undefined): Record<string, string> | undefined {
  const tint = emotion ? MOOD_TINTS[emotion] : undefined
  if (!tint)
    return undefined

  return {
    // An inset shadow draws the edge without changing the bubble's size, and the gradient lays the wash over its background.
    boxShadow: `inset 3px 0 0 ${tint.edge}`,
    backgroundImage: `linear-gradient(${tint.wash}, ${tint.wash})`,
  }
}
