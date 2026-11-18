// Dahlia: her face follows what she says when her reply doesn't say how she feels. A reply can set her expression
// with ACT markers; when one doesn't, each sentence she speaks goes to her server, where the decision model (OpenJev)
// picks the feeling it shows (POST /api/v1/dahlia/expression, Gateway/Expression.cs), and the stage shows it as
// the sentence plays. Once a reply sets an emotion itself, its own markers decide for the rest of it. The idea is the
// "System 1" expression cues of dasilva333/airi (use-autonomous-cues.ts); the code is Dahlia's. Stage.vue runs it.
// This file is Dahlia's (AIRI has no such file).

import { readActEmotion } from '@proj-airi/core-agent'

import { dahliaHeaders, dahliaKey } from '../stores/dahlia-auth'
import { SERVER_URL } from './server'

/** "false" when the person turned automatic expressions off (Settings > Dahlia); on otherwise. */
export const DAHLIA_AUTO_EXPRESSIONS_KEY = 'dahlia/auto-expressions'
/** A sentence's face comes too late after this, so it isn't shown. */
export const AUTO_EXPRESSION_TIMEOUT_MS = 2500
/** After her server can't answer, it isn't asked again for this long. */
export const AUTO_EXPRESSION_BACKOFF_MS = 60_000

export function dahliaAutoExpressionsEnabled() {
  try {
    return localStorage.getItem(DAHLIA_AUTO_EXPRESSIONS_KEY) !== 'false'
  }
  catch {
    return true
  }
}

/** A sentence worth reading a feeling from: two words or more, not only punctuation or a sound. */
export function classifiableSentence(text: string) {
  const clean = text.trim()
  if (!/[\p{L}\p{N}]/u.test(clean))
    return false
  // Scripts without spaces between words say a phrase in three characters.
  const cjk = clean.replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, '')
  if (cjk.length > 0)
    return cjk.length >= 3
  return clean.length >= 7 && clean.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length >= 2
}

/** Asks her server which feeling a sentence shows: an emotion name, null for none, undefined when it can't say. */
export async function askDahliaExpression(text: string, signal: AbortSignal, serverUrl = SERVER_URL, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<string | null | undefined> {
  if (!dahliaKey())
    return undefined
  const response = await fetcher(`${serverUrl}/api/v1/dahlia/expression`, {
    method: 'POST',
    headers: dahliaHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text }),
    signal,
  })
  if (!response.ok)
    return undefined
  const answer = await response.json() as { ready?: boolean, emotion?: string | null }
  return answer.ready ? answer.emotion ?? null : undefined
}

export interface DahliaAutoExpressionsOptions {
  /** The feeling of a sentence: an emotion name, null for none, undefined when it can't be had now. */
  classify: (text: string, signal: AbortSignal) => Promise<string | null | undefined>
  /** Shows the emotion on her avatar. */
  show: (emotion: string) => void
  enabled?: () => boolean
  now?: () => number
  timeoutMs?: number
}

/** Follows the turns that speak: what each piece says and whether the reply set an emotion itself. */
export function createDahliaAutoExpressions(options: DahliaAutoExpressionsOptions) {
  const enabled = options.enabled ?? dahliaAutoExpressionsEnabled
  const now = options.now ?? Date.now
  /** The turns whose reply set an emotion with a marker. */
  const marked = new Set<string>()
  /** The piece that plays now, per turn: a late answer for an earlier piece isn't shown. */
  const playing = new Map<string, number>()
  let pieces = 0
  let quietUntil = 0

  return {
    /** A special token of the turn played: an emotion marker hands the turn's face back to its markers. */
    special(turnId: string, special: string) {
      if (readActEmotion(special))
        marked.add(turnId)
    },

    /** A piece of the turn starts playing: its face, unless the reply sets them itself. */
    async spoken(turnId: string, text: string) {
      const piece = ++pieces
      playing.set(turnId, piece)
      if (!enabled() || marked.has(turnId) || now() < quietUntil || !classifiableSentence(text))
        return

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? AUTO_EXPRESSION_TIMEOUT_MS)
      try {
        const emotion = await options.classify(text, controller.signal)
        if (emotion === undefined)
          quietUntil = now() + AUTO_EXPRESSION_BACKOFF_MS
        else if (emotion && playing.get(turnId) === piece && !marked.has(turnId))
          options.show(emotion)
      }
      catch {
        // Too slow, or her server is away: this piece keeps her face as it is.
        if (!controller.signal.aborted)
          quietUntil = now() + AUTO_EXPRESSION_BACKOFF_MS
      }
      finally {
        clearTimeout(timer)
      }
    },

    /** The turn ended. */
    ended(turnId: string) {
      marked.delete(turnId)
      playing.delete(turnId)
    },
  }
}
