// Dahlia: where on the screen to look closely. When she watches a screen, the whole-screen picture her model gets
// is scaled down, and small text in it blurs. So next to it the PC sends the part that matters at full size: the
// region around the text that is new or that caused the look (from the boxes Windows' OCR gives each word), or,
// where the screen has no readable text, the part of the picture that changed. The idea of looking with the whole
// eye first and then fixing on one spot at full resolution comes from the attention lab of dasilva333/airi
// (docs/design-attention-ecology-screen-watching.md §16, MIT), which finds the spot with a vision model; Dahlia
// finds it from what her OCR and her change detection already know, with no model. This file is Dahlia's.

import type { DahliaScreenWord } from './dahlia-game-player'

/** A rectangle in thousandths of the screen: x1, y1 (top left) to x2, y2. */
export interface DahliaFocusBox { x1: number, y1: number, x2: number, y2: number }

export interface DahliaFocusRegion {
  box: DahliaFocusBox
  /** Where it is, in words: "top left", "center", "bottom right", … */
  zone: string
  /** What it was found from. */
  from: 'line' | 'new-text' | 'picture'
}

/** A region larger than this share of the screen is no closer look: the whole picture shows it. */
export const FOCUS_MAX_SHARE = 0.45
/** Smaller regions grow to this, so there is something around the spot. */
export const FOCUS_MIN_WIDTH = 260
export const FOCUS_MIN_HEIGHT = 160
/** Room around what was found. */
export const FOCUS_PAD = 30
/** A thumbnail cell this much brighter or darker changed (as screenChanged counts it). */
const CELL_DELTA = 20
/** New words must be at least this many, or this share of the words on screen, to be a spot of their own. */
const NEW_WORDS_MIN = 3

function clamp(value: number) {
  return Math.min(1000, Math.max(0, Math.round(value)))
}

function grow(box: DahliaFocusBox): DahliaFocusBox {
  let { x1, y1, x2, y2 } = box
  x1 -= FOCUS_PAD
  y1 -= FOCUS_PAD
  x2 += FOCUS_PAD
  y2 += FOCUS_PAD
  const addX = Math.max(0, FOCUS_MIN_WIDTH - (x2 - x1)) / 2
  const addY = Math.max(0, FOCUS_MIN_HEIGHT - (y2 - y1)) / 2
  x1 -= addX
  x2 += addX
  y1 -= addY
  y2 += addY
  // Pushed back inside the screen without getting smaller.
  if (x1 < 0) {
    x2 -= x1
    x1 = 0
  }
  if (y1 < 0) {
    y2 -= y1
    y1 = 0
  }
  if (x2 > 1000) {
    x1 -= x2 - 1000
    x2 = 1000
  }
  if (y2 > 1000) {
    y1 -= y2 - 1000
    y2 = 1000
  }
  return { x1: clamp(x1), y1: clamp(y1), x2: clamp(x2), y2: clamp(y2) }
}

function around(words: DahliaScreenWord[]): DahliaFocusBox {
  return {
    x1: Math.min(...words.map(word => word.x)),
    y1: Math.min(...words.map(word => word.y)),
    x2: Math.max(...words.map(word => word.x + word.w)),
    y2: Math.max(...words.map(word => word.y + word.h)),
  }
}

/** Where a box is on the screen, by its middle: "top left", "center", "bottom right", … */
export function zoneOf(box: DahliaFocusBox) {
  const x = (box.x1 + box.x2) / 2
  const y = (box.y1 + box.y2) / 2
  const column = x < 333 ? 'left' : x > 667 ? 'right' : ''
  const row = y < 333 ? 'top' : y > 667 ? 'bottom' : ''
  return [row, column].filter(Boolean).join(' ') || 'center'
}

/** The part of two capture thumbnails (16x16 grayscale, base64) that differs, or undefined when none does. */
export function changedBox(before: string | undefined, after: string | undefined): DahliaFocusBox | undefined {
  if (!before || !after)
    return undefined
  let a: string
  let b: string
  try {
    a = atob(before)
    b = atob(after)
  }
  catch {
    return undefined
  }
  const side = Math.round(Math.sqrt(a.length))
  if (a.length !== b.length || side * side !== a.length || side === 0)
    return undefined
  let minX = side
  let minY = side
  let maxX = -1
  let maxY = -1
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) <= CELL_DELTA)
      continue
    const x = i % side
    const y = Math.floor(i / side)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (maxX < 0)
    return undefined
  const cell = 1000 / side
  return { x1: clamp(minX * cell), y1: clamp(minY * cell), x2: clamp((maxX + 1) * cell), y2: clamp((maxY + 1) * cell) }
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface DahliaFocusInput {
  /** The words on the capture with their boxes, when the PC could read them. */
  words?: DahliaScreenWord[]
  /** The words (lower case) that were on the screen at her last look. */
  known?: ReadonlySet<string>
  /** The line that caused the look (a problem, or a word she watches for), as the filter gave it. */
  line?: string
  /** The thumbnails of her last look and of this capture. */
  before?: string
  after?: string
}

/**
 * The part of the screen worth a closer look, or undefined when there is none (nothing stands out, or it is most
 * of the screen anyway). First the line that caused the look, then the text that is new since her last look, then
 * the part of the picture that changed.
 */
export function focusRegion(input: DahliaFocusInput): DahliaFocusRegion | undefined {
  const words = input.words ?? []
  const candidates: Array<{ box: DahliaFocusBox, from: DahliaFocusRegion['from'] }> = []

  if (input.line && words.length > 0) {
    const wanted = normalize(input.line)
    const lines = new Map<number, DahliaScreenWord[]>()
    for (const word of words)
      lines.set(word.l, [...(lines.get(word.l) ?? []), word])
    const hit = [...lines.values()].find((line) => {
      const text = normalize(line.map(word => word.t).join(' '))
      return text.length > 0 && (wanted.includes(text) || text.includes(wanted))
    })
    if (hit) {
      // The lines right above and below belong to it: a stack trace, the rest of a dialog.
      const middle = (around(hit).y1 + around(hit).y2) / 2
      const height = Math.max(20, around(hit).y2 - around(hit).y1)
      candidates.push({ box: around(words.filter(word => Math.abs(word.y + word.h / 2 - middle) <= height * 4)), from: 'line' })
    }
  }

  if (input.known && words.length > 0) {
    const fresh = words.filter(word => word.t.length > 1 && !input.known!.has(word.t.toLowerCase()))
    if (fresh.length >= NEW_WORDS_MIN && fresh.length < words.length * 0.8)
      candidates.push({ box: around(fresh), from: 'new-text' })
  }

  const changed = changedBox(input.before, input.after)
  if (changed)
    candidates.push({ box: changed, from: 'picture' })

  for (const candidate of candidates) {
    const box = grow(candidate.box)
    const share = ((box.x2 - box.x1) * (box.y2 - box.y1)) / 1_000_000
    if (share <= FOCUS_MAX_SHARE)
      return { box, zone: zoneOf(box), from: candidate.from }
  }
  return undefined
}

/** The words of a capture, lower case, to compare the next capture with. */
export function wordSet(words: DahliaScreenWord[] | undefined): Set<string> {
  return new Set((words ?? []).map(word => word.t.toLowerCase()))
}
