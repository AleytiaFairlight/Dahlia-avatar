// Dahlia: decides which changed captures of a watched screen are worth one of her model's turns. Without it every
// changed capture went to her server, and a game (a capture every second, always changing) kept her model busy all
// the time. The PC now looks first, with what it has for free: the text Windows reads on the capture and the window
// in front. A capture goes to her server when the window in front changed, when text that looks like a problem
// appeared, when words the person asked her to watch for appeared, or when most of the text changed; otherwise it
// waits. The idea and the text matching (problem patterns, fuzzy matching of words that OCR misread) come from the
// attention gate of dasilva333/airi (MIT, packages/stage-ui/src/workers/attention-guard/engine/ocr.ts); Dahlia
// reads the text with Windows' own OCR instead of models in the app. This file is Dahlia's (AIRI has no such file).

import type { DahliaScreenWord } from './dahlia-game-player'

/** Text that looks like something went wrong. */
export const SCREEN_PROBLEM_PATTERNS: RegExp[] = [
  /command not found/i,
  /invalid option/i,
  /\berrors?\b/i,
  /\bfailed\b/i,
  /traceback/i,
  /permission denied/i,
  /syntaxerror/i,
  /typeerror/i,
  /fatal:/i,
  /exception/i,
  /unhandled/i,
  /panic:/i,
  /not responding/i,
  /has stopped working/i,
]

/** One pattern alone is often an ordinary word on a page; two different ones are a problem. */
export const SCREEN_PROBLEM_MIN = 2
/** This share of the words being new counts as another screen. */
export const SCREEN_TEXT_CHANGE = 0.35
/** With fewer words than this on both captures, the text says nothing about a change. */
export const SCREEN_TEXT_MIN_WORDS = 5
/** Between two looks: none needed at a capture every 15 seconds, a pause while watching a game. */
export const SCREEN_LOOK_GAP_MS = 0
export const SCREEN_LOOK_GAP_GAME_MS = 8000
/** Even a problem or a watched word waits this long after the last look. */
export const SCREEN_LOOK_GAP_URGENT_MS = 2000
/** Looks in an hour, so watching can't take her model over. */
export const SCREEN_LOOKS_PER_HOUR = 120
export const SCREEN_LOOKS_PER_HOUR_GAME = 300
export const SCREEN_INTERESTS_MAX = 20
/** The words to watch for, a JSON list, shared between the windows (Settings > Modules > Vision edits it). */
export const DAHLIA_SCREEN_INTERESTS_KEY = 'dahlia/screen-watch-interests'

export type DahliaAttentionReason
  = | 'first' | 'refresh' | 'window' | 'problem' | 'interest' | 'meaning' | 'text' | 'picture'
    | 'quiet' | 'too-soon' | 'limit'

export interface DahliaScreenFrame {
  /** The text on the capture, a line of the screen a line; undefined when the PC couldn't read it. */
  text?: string
  /** The words of that text with their places, for finding where to look closely (dahlia-screen-focus.ts). */
  words?: DahliaScreenWord[]
  /** The window in front, as "title (program)". */
  window?: string
}

export interface DahliaAttentionVerdict {
  look: boolean
  reason: DahliaAttentionReason
  /** Why the capture is worth a look, for her model: the line with the problem or the watched word. */
  focus?: string
}

export function describeAttention(reason: DahliaAttentionReason | undefined) {
  switch (reason) {
    case 'first': return 'the first look'
    case 'refresh': return 'her note was getting old'
    case 'window': return 'another window came to the front'
    case 'problem': return 'something that looks like a problem appeared'
    case 'interest': return 'something you asked her to watch for appeared'
    case 'meaning': return 'her server read that something worth a look is on the screen'
    case 'text': return 'most of the text changed'
    case 'picture': return 'the picture changed'
    case 'quiet': return 'nothing new on the screen'
    case 'too-soon': return 'she looked a moment ago'
    case 'limit': return 'she has looked as often as she may in an hour'
    default: return ''
  }
}

function fuzzyDistanceFor(letters: number) {
  return letters >= 8 ? 2 : letters >= 5 ? 1 : 0
}

/** Levenshtein distance, given up (max + 1) as soon as it is over max. */
function boundedLevenshtein(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max)
    return max + 1
  if (a === b)
    return 0
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let current = Array.from<number>({ length: b.length + 1 })
  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    let least = i
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      least = Math.min(least, current[j])
    }
    if (least > max)
      return max + 1
    const swap = previous
    previous = current
    current = swap
  }
  return previous[b.length]
}

/** A phrase against the words OCR read, forgiving one or two misread letters in a long phrase. */
function fuzzyPhraseMatch(tokens: string[], phrase: string) {
  const words = phrase.split(' ').filter(Boolean)
  const max = fuzzyDistanceFor(phrase.replace(/ /g, '').length)
  if (words.length === 0 || tokens.length === 0 || max === 0)
    return false
  // One word wider too, for a phrase OCR split ("o pen ide").
  for (let span = words.length; span <= Math.min(words.length + 1, tokens.length); span++) {
    for (let i = 0; i + span <= tokens.length; i++) {
      const candidate = tokens.slice(i, i + span).join(' ')
      if (boundedLevenshtein(candidate, phrase, max) <= max)
        return true
    }
  }
  return false
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[_-]/g, ' ')
}

function tokensOf(text: string) {
  return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** The watched words that the text mentions. */
export function matchInterests(text: string, interests: string[]) {
  const lower = normalize(text)
  const tokens = tokensOf(text)
  return interests.map(interest => interest.trim()).filter((interest) => {
    if (!interest)
      return false
    const phrase = normalize(interest).replace(/\s+/g, ' ')
    // A short word must stand alone ("ide" isn't in "hidden"); a longer one may be part of a word.
    if (phrase.length >= 5 ? lower.includes(phrase) : tokens.includes(phrase) || (phrase.includes(' ') && lower.includes(phrase)))
      return true
    return fuzzyPhraseMatch(tokens, phrase)
  })
}

/** The problem patterns the text matches, by their source. */
export function matchProblems(text: string) {
  return SCREEN_PROBLEM_PATTERNS.filter(pattern => pattern.test(text)).map(pattern => pattern.source)
}

/** The line that says most about a match, for her model. */
export function relevantLine(text: string, problems: string[], interests: string[]) {
  const lines = text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const patterns = problems.map(source => new RegExp(source, 'i'))
  const line = lines.find(line => patterns.some(pattern => pattern.test(line)))
    ?? lines.find(line => matchInterests(line, interests).length > 0)
  return (line ?? '').slice(0, 200)
}

/** The words to watch for, from a list or a text with commas or lines. */
export function parseInterests(value: unknown) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : []
  const seen = new Set<string>()
  return items
    .map(item => (typeof item === 'string' ? item : '').replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter(item => item.length >= 2 && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase()))
    .slice(0, SCREEN_INTERESTS_MAX)
}

interface Noted {
  at: number
  window?: string
  tokens?: Set<string>
  problems: Set<string>
  interests: Set<string>
}

export interface DahliaScreenAttentionOptions {
  interests?: () => string[]
  now?: () => number
}

export class DahliaScreenAttention {
  private last: Noted | undefined
  private looks: number[] = []

  constructor(private readonly options: DahliaScreenAttentionOptions = {}) {}

  private now() {
    return (this.options.now ?? Date.now)()
  }

  private read(frame: DahliaScreenFrame) {
    const interests = this.options.interests?.() ?? []
    const text = frame.text
    const everything = `${frame.window ?? ''}\n${text ?? ''}`
    return {
      tokens: text === undefined ? undefined : new Set(tokensOf(text)),
      problems: text === undefined ? [] : matchProblems(text),
      interests: matchInterests(everything, interests),
      line: (problems: string[], matched: string[]) => relevantLine(everything, problems, matched),
    }
  }

  /** Forgets what she saw, for a new watch. */
  reset() {
    this.last = undefined
    this.looks = []
  }

  /** Whether a capture whose picture changed is worth a look. force: her note is getting old, look anyway. */
  judge(frame: DahliaScreenFrame, session: { game?: boolean, force?: boolean } = {}): DahliaAttentionVerdict {
    const now = this.now()
    const last = this.last
    if (!last)
      return { look: true, reason: 'first' }
    if (session.force)
      return { look: true, reason: 'refresh' }

    const seen = this.read(frame)
    const newProblems = seen.problems.filter(problem => !last.problems.has(problem))
    const newInterests = seen.interests.filter(interest => !last.interests.has(interest))

    let verdict: DahliaAttentionVerdict
    let gap = session.game ? SCREEN_LOOK_GAP_GAME_MS : SCREEN_LOOK_GAP_MS
    if (newInterests.length > 0) {
      verdict = { look: true, reason: 'interest', focus: [newInterests.join(', '), seen.line([], newInterests)].filter(Boolean).join(': ') }
      gap = SCREEN_LOOK_GAP_URGENT_MS
    }
    else if (seen.problems.length >= SCREEN_PROBLEM_MIN && newProblems.length > 0) {
      verdict = { look: true, reason: 'problem', focus: seen.line(newProblems, []) || undefined }
      gap = SCREEN_LOOK_GAP_URGENT_MS
    }
    else if (frame.window !== undefined && last.window !== undefined && frame.window !== last.window) {
      verdict = { look: true, reason: 'window' }
      gap = Math.max(SCREEN_LOOK_GAP_URGENT_MS, gap / 2)
    }
    else if (seen.tokens === undefined || last.tokens === undefined || (seen.tokens.size < SCREEN_TEXT_MIN_WORDS && last.tokens.size < SCREEN_TEXT_MIN_WORDS)) {
      // The PC couldn't read the text, or there is hardly any (a video, a game's world): the changed picture is
      // all there is to go by.
      verdict = { look: true, reason: 'picture' }
    }
    else {
      let shared = 0
      for (const token of seen.tokens) {
        if (last.tokens.has(token))
          shared++
      }
      const union = seen.tokens.size + last.tokens.size - shared
      if (union === 0 || 1 - shared / union < SCREEN_TEXT_CHANGE)
        return { look: false, reason: 'quiet' }
      verdict = { look: true, reason: 'text' }
    }

    this.looks = this.looks.filter(at => now - at < 3_600_000)
    if (this.looks.length >= (session.game ? SCREEN_LOOKS_PER_HOUR_GAME : SCREEN_LOOKS_PER_HOUR))
      return { look: false, reason: 'limit' }
    if (now - last.at < gap)
      return { look: false, reason: 'too-soon' }
    return verdict
  }

  /** Her server noted this capture: later captures are compared with it. */
  noted(frame: DahliaScreenFrame) {
    const seen = this.read(frame)
    const now = this.now()
    this.last = { at: now, window: frame.window, tokens: seen.tokens, problems: new Set(seen.problems), interests: new Set(seen.interests) }
    this.looks.push(now)
  }
}
