// Dahlia: a speech bubble at her 3D avatar's head with what she is saying, tinted by how she feels. The stage tells it
// each piece she speaks and each feeling she shows (sayDahliaBubble, setDahliaBubbleMood); DahliaSpeechBubble.vue
// draws it in the scene, beside her head, the way the presence bubble is drawn. After the head-tethered caption of
// dasilva333/airi, which paints a Canvas2D bubble with sentiment styles at the model's head; the code is Dahlia's.
// This file is Dahlia's (AIRI has no such file).

/** "false" when the person turned the bubble off (Settings > Dahlia); on otherwise. */
export const DAHLIA_SPEECH_BUBBLE_KEY = 'dahlia/speech-bubble'
/** The bubble's text box, in screen pixels. */
export const BUBBLE_MAX_WIDTH = 260
export const BUBBLE_MAX_LINES = 4
export const BUBBLE_FONT_PX = 14
export const BUBBLE_LINE_PX = 19
export const BUBBLE_PADDING_PX = 10
export const BUBBLE_TAIL_PX = 12
/** A long piece is shown a part at a time, each about this long. */
export const BUBBLE_PART_CHARS = 90
/** How long a part stays before the next: by its length, within these bounds. */
export const BUBBLE_PART_MIN_MS = 1200
export const BUBBLE_PART_MAX_MS = 2800
export const BUBBLE_MS_PER_CHAR = 45
/** After she stops speaking, the bubble stays this long. */
export const BUBBLE_LINGER_MS = 2500

export type DahliaBubbleMood = 'happy' | 'sad' | 'angry' | 'surprised' | 'think' | 'awkward' | 'curious' | 'neutral'

/** The edge color and the small sign of each feeling. */
export const BUBBLE_MOODS: Record<DahliaBubbleMood, { edge: string, sign?: 'heart' | 'drop' | 'star' | 'spark' | 'dots' }> = {
  happy: { edge: '#10b981', sign: 'heart' },
  sad: { edge: '#3b82f6', sign: 'drop' },
  angry: { edge: '#f43f5e', sign: 'spark' },
  surprised: { edge: '#a855f7', sign: 'star' },
  think: { edge: '#f59e0b', sign: 'dots' },
  curious: { edge: '#f59e0b', sign: 'dots' },
  awkward: { edge: '#f472b6', sign: 'drop' },
  neutral: { edge: '#a3a3a3' },
}

export function dahliaSpeechBubbleEnabled() {
  try {
    return localStorage.getItem(DAHLIA_SPEECH_BUBBLE_KEY) !== 'false'
  }
  catch {
    return true
  }
}

/** A feeling the bubble knows, or undefined. */
export function bubbleMood(name: string | undefined): DahliaBubbleMood | undefined {
  if (name === 'question')
    return 'curious'
  return name && name in BUBBLE_MOODS ? name as DahliaBubbleMood : undefined
}

/** Where to cut a part of speech: after a sentence, else after a comma, else between words, not too early. */
function cutAt(window: string) {
  const sentence = Math.max(...['. ', '! ', '? ', '… '].map(mark => window.lastIndexOf(mark)))
  if (sentence > window.length / 3)
    return sentence + 1
  const comma = window.lastIndexOf(', ')
  if (comma > window.length / 3)
    return comma + 1
  const space = window.lastIndexOf(' ')
  return space > 0 ? space : window.length
}

/** A piece of speech in parts of about `size` characters. */
export function bubbleParts(text: string, size = BUBBLE_PART_CHARS): string[] {
  const parts: string[] = []
  let rest = text.replace(/\s+/g, ' ').trim()
  while (rest.length > size) {
    const at = cutAt(rest.slice(0, size + 1))
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest)
    parts.push(rest)
  return parts
}

/** How long a part stays before the next one. */
export function bubblePartMs(part: string) {
  return Math.min(BUBBLE_PART_MAX_MS, Math.max(BUBBLE_PART_MIN_MS, part.length * BUBBLE_MS_PER_CHAR))
}

/** Lines of `text` that fit `maxWidth` as `measure` measures them; the last one ends in "…" when there is more. */
export function wrapBubbleText(text: string, measure: (line: string) => number, maxWidth = BUBBLE_MAX_WIDTH - BUBBLE_PADDING_PX * 2, maxLines = BUBBLE_MAX_LINES) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (measure(next) <= maxWidth || !line) {
      line = next
      continue
    }
    lines.push(line)
    line = word
  }
  if (line)
    lines.push(line)
  if (lines.length <= maxLines)
    return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length > 1 && measure(`${last}…`) > maxWidth)
    last = last.slice(0, -1).trimEnd()
  kept[maxLines - 1] = `${last}…`
  return kept
}

/**
 * Where the bubble goes, in screen pixels: above her head and to the side with room, inside the stage. `tail` says
 * which bottom corner the tail leaves from, toward the head.
 */
export function placeBubble(head: { x: number, y: number, width: number, height: number }, bubble: { width: number, height: number }, stage: { width: number, height: number }, margin = 8) {
  const total = bubble.height + BUBBLE_TAIL_PX
  const rightX = head.x + head.width * 0.75
  const leftX = head.x + head.width * 0.25 - bubble.width
  const right = rightX + bubble.width <= stage.width - margin || leftX < margin
  let x = right ? rightX : leftX
  let y = head.y - total + head.height * 0.15
  x = Math.min(Math.max(margin, x), Math.max(margin, stage.width - margin - bubble.width))
  y = Math.min(Math.max(margin, y), Math.max(margin, stage.height - margin - total))
  return { x, y, tail: right ? 'left' as const : 'right' as const }
}

/** Speech for the bubble: the scene listens; the stage tells. */
export type DahliaBubbleEvent = { type: 'say', text: string } | { type: 'mood', mood: DahliaBubbleMood } | { type: 'done' }
type Listener = (event: DahliaBubbleEvent) => void
const listeners = new Set<Listener>()

export function onDahliaBubble(listener: Listener) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function tell(event: DahliaBubbleEvent) {
  for (const listener of listeners)
    listener(event)
}

/** A piece she starts saying. */
export function sayDahliaBubble(text: string) {
  if (text.trim())
    tell({ type: 'say', text })
}

/** A feeling she shows now. */
export function setDahliaBubbleMood(name: string) {
  const mood = bubbleMood(name)
  if (mood)
    tell({ type: 'mood', mood })
}

/** She stopped speaking: the bubble goes after a moment. */
export function endDahliaBubble() {
  tell({ type: 'done' })
}
