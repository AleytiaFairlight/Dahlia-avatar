// Dahlia: thinking fillers. Her model runs on her own machines, and an answer can take several seconds to start;
// until then she was silent. When a spoken answer hasn't started after a moment, she now says a short phrase that
// fits the question ("Hmm, let me think."), and another if it takes much longer. The phrase goes into the answer's
// own speech, in front of it, so it has her voice, never talks over the answer and stops with it; it is spoken
// only, not written into the chat. Answers that start quickly get none: the wait is measured, and while recent
// answers started fast she doesn't arm it at all. The idea (a deadline from recent waits, phrases by the kind of
// question, a few per turn at most) comes from the turn pacing of dasilva333/airi (MIT,
// packages/stage-ui/src/libs/pacing); the code is Dahlia's, on her speech pipeline, which needs no cache of filler
// audio. Stage.vue starts it (scripts/apply_avatar_branding.sh adds the call). This file is Dahlia's.

export type DahliaThinkingKind = 'analytical' | 'memory' | 'emotional' | 'uncertain' | 'generic'

/** "false" when the person turned thinking fillers off (Settings > Dahlia); on otherwise. */
export const DAHLIA_THINKING_FILLERS_KEY = 'dahlia/thinking-fillers'

/** A spoken answer that hasn't started after this long gets the first phrase. */
export const FILLER_FIRST_MS = 2500
/** How much longer until each further phrase. */
export const FILLER_LATER_MS = [12_000, 25_000]
/** While the usual wait is shorter than this, answers come fast enough and nothing is armed. */
export const FILLER_FAST_MS = 1800
export const FILLER_WAIT_SAMPLES = 5

const WORDS: Record<Exclude<DahliaThinkingKind, 'generic'>, string[]> = {
  analytical: ['calculate', 'compute', 'analyze', 'analyse', 'compare', 'explain', 'why', 'how', 'solve', 'code', 'bug', 'error', 'fix', 'math', 'estimate', 'plan', 'difference', 'optimize', 'debug', 'translate'],
  memory: ['remember', 'recall', 'remind', 'yesterday', 'earlier', 'before', 'ago', 'forgot', 'forget', 'history', 'previous', 'last time', 'last week', 'did i', 'did we', 'what was'],
  emotional: ['feel', 'feeling', 'sad', 'happy', 'angry', 'tired', 'lonely', 'worried', 'anxious', 'scared', 'sorry', 'miss', 'love', 'hurt', 'upset', 'stressed', 'afraid', 'cry'],
  uncertain: ['maybe', 'perhaps', 'should i', 'what if', 'which', 'unsure', 'not sure', 'wonder', 'or should', 'recommend', 'better', 'choose', 'decide', 'opinion', 'think i should'],
}

const PHRASES: Record<DahliaThinkingKind, string[]> = {
  analytical: ['Hmm, let me work that out.', 'Okay, let me think that through.', 'Give me a second to figure this out.'],
  memory: ['Hmm, let me remember.', 'Let me think back for a moment.', 'One moment, I\'m trying to recall.'],
  emotional: ['Mm. Give me a moment.', 'Hmm. Let me think about that.', 'I hear you. One moment.'],
  uncertain: ['Hmm, good question.', 'Let me think about which is better.', 'Hmm, let me weigh that.'],
  generic: ['Hmm, let me think.', 'One moment.', 'Let me see.', 'Hmm, give me a second.'],
}

const LATER_PHRASES = ['Still thinking, one moment.', 'Almost there.', 'This one takes me a little longer.', 'Bear with me.']

/** The kind of question, from its words; the kind with the most matches wins, generic without any. */
export function classifyThinking(text: string): DahliaThinkingKind {
  const lower = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' ')} `
  let best: DahliaThinkingKind = 'generic'
  let most = 0
  for (const [kind, words] of Object.entries(WORDS) as Array<[Exclude<DahliaThinkingKind, 'generic'>, string[]]>) {
    const count = words.filter(word => lower.includes(` ${word} `)).length
    if (count > most) {
      most = count
      best = kind
    }
  }
  return best
}

export interface DahliaThinkingFillersOptions {
  /** Says a phrase in the turn's own speech; false when the turn has no speech to say it in. */
  speak: (turn: string, phrase: string) => boolean
  enabled?: () => boolean
  now?: () => number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
  random?: () => number
}

interface Waiting {
  startedAt: number
  kind: DahliaThinkingKind
  spoken: number
  timer?: unknown
}

export class DahliaThinkingFillers {
  private readonly turns = new Map<string, Waiting>()
  /** How long recent answers took to start. */
  private waits: number[] = []
  private lastPhrase = ''

  constructor(private readonly options: DahliaThinkingFillersOptions) {}

  private now() {
    return (this.options.now ?? Date.now)()
  }

  /** The usual wait for an answer to start, or undefined before any was measured. */
  usualWait() {
    if (this.waits.length === 0)
      return undefined
    const sorted = [...this.waits].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  private pick(phrases: string[]) {
    const fresh = phrases.filter(phrase => phrase !== this.lastPhrase)
    const from = fresh.length > 0 ? fresh : phrases
    const phrase = from[Math.min(from.length - 1, Math.floor((this.options.random ?? Math.random)() * from.length))]
    this.lastPhrase = phrase
    return phrase
  }

  private arm(turn: string, waiting: Waiting, ms: number) {
    waiting.timer = (this.options.setTimer ?? setTimeout)(() => {
      if (this.turns.get(turn) !== waiting)
        return
      const phrase = this.pick(waiting.spoken === 0 ? PHRASES[waiting.kind] : LATER_PHRASES)
      if (!this.options.speak(turn, phrase)) {
        this.turns.delete(turn)
        return
      }
      const later = FILLER_LATER_MS[waiting.spoken++]
      if (later !== undefined)
        this.arm(turn, waiting, later)
    }, ms)
  }

  /** A spoken turn was sent to her model; text is what the person said. */
  turnStarted(turn: string, text: string) {
    this.turnEnded(turn)
    const waiting: Waiting = { startedAt: this.now(), kind: classifyThinking(text), spoken: 0 }
    this.turns.set(turn, waiting)
    const usual = this.usualWait()
    if (this.options.enabled?.() === false || (usual !== undefined && usual < FILLER_FAST_MS))
      return
    this.arm(turn, waiting, FILLER_FIRST_MS)
  }

  /** The answer's first words arrived: no more phrases for this turn. */
  answerStarted(turn: string) {
    const waiting = this.turns.get(turn)
    if (!waiting)
      return
    this.waits = [...this.waits, this.now() - waiting.startedAt].slice(-FILLER_WAIT_SAMPLES)
    this.turnEnded(turn)
  }

  /** The turn ended or was canceled. */
  turnEnded(turn: string) {
    const waiting = this.turns.get(turn)
    if (!waiting)
      return
    if (waiting.timer !== undefined)
      (this.options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>)))(waiting.timer)
    this.turns.delete(turn)
  }
}

/** Whether the person left thinking fillers on. */
export function dahliaThinkingFillersEnabled() {
  try {
    return localStorage.getItem(DAHLIA_THINKING_FILLERS_KEY) !== 'false'
  }
  catch {
    return true
  }
}

interface SpokenTurn { turnId?: string, sessionId?: string }
type ChatHook<Arguments extends unknown[]> = (callback: (...args: Arguments) => Promise<void>) => () => void

/**
 * Connects thinking fillers to the chat's hooks and the stage's speech. speaks: whether a turn is spoken at all
 * (and not muted); speech: the turn's speech, which the answer's words are written into too. Answers the hooks'
 * disposers.
 */
export function startDahliaThinkingFillers<Turn extends SpokenTurn>(
  hooks: {
    onBeforeSend: ChatHook<[string, Turn]>
    onTokenLiteral: ChatHook<[string, Turn]>
    onStreamEnd: ChatHook<[Turn]>
    onAssistantResponseEnd: ChatHook<[string, Turn]>
  },
  stage: {
    speaks: (turn: Turn) => boolean
    speech: (turn: Turn) => { write: (text: string) => unknown, flush: () => void } | undefined
  },
  options: Partial<DahliaThinkingFillersOptions> = {},
) {
  const waiting = new Map<string, Turn>()
  const keyOf = (turn: Turn) => `${turn.sessionId ?? ''}/${turn.turnId ?? ''}`
  const fillers = new DahliaThinkingFillers({
    enabled: dahliaThinkingFillersEnabled,
    ...options,
    speak: (key, phrase) => {
      const turn = waiting.get(key)
      const speech = turn && stage.speaks(turn) ? stage.speech(turn) : undefined
      if (!speech)
        return false
      // The phrase ends its sentence and is flushed, so it is spoken now and not when the answer's words arrive.
      void Promise.resolve(speech.write(`${phrase} `)).then(() => speech.flush()).catch(error => console.warn('Dahlia: a thinking filler wasn\'t spoken:', error))
      return true
    },
  })
  const ended = (turn: Turn) => {
    fillers.turnEnded(keyOf(turn))
    waiting.delete(keyOf(turn))
  }

  return [
    hooks.onBeforeSend(async (message, turn) => {
      if (!stage.speaks(turn))
        return
      waiting.set(keyOf(turn), turn)
      fillers.turnStarted(keyOf(turn), message)
    }),
    hooks.onTokenLiteral(async (literal, turn) => {
      if (literal.trim() && waiting.has(keyOf(turn))) {
        fillers.answerStarted(keyOf(turn))
        waiting.delete(keyOf(turn))
      }
    }),
    hooks.onStreamEnd(async turn => ended(turn)),
    hooks.onAssistantResponseEnd(async (_message, turn) => ended(turn)),
  ]
}
