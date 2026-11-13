// Dahlia: reply suggestions. After an answer of hers, the chat can show up to three short replies to tap, which
// fill the message box (they aren't sent until the person sends them). Her server writes them with her model
// (POST /api/v1/dahlia/suggestions), which is one more request for each answer, so it is off until turned on in
// Settings > Dahlia. The idea is the auto suggestions of dasilva333/airi; the code is Dahlia's.
// components/scenarios/chat/dahlia-reply-suggestions.vue shows them. This file is Dahlia's.

import { SERVER_URL } from './server'

/** "true" when the person turned suggestions on (Settings > Dahlia); off otherwise. */
export const DAHLIA_REPLY_SUGGESTIONS_KEY = 'dahlia/reply-suggestions'

export function dahliaReplySuggestionsEnabled() {
  try {
    return localStorage.getItem(DAHLIA_REPLY_SUGGESTIONS_KEY) === 'true'
  }
  catch {
    return false
  }
}

/** What a model's answer should hold: short, different lines. Anything else is left out. */
export function cleanDahliaReplies(value: unknown): string[] {
  if (!Array.isArray(value))
    return []
  const seen = new Set<string>()
  return value
    .map(reply => (typeof reply === 'string' ? reply.replace(/\s+/g, ' ').trim() : ''))
    .filter(reply => reply.length > 1 && reply.length <= 90 && !seen.has(reply.toLowerCase()) && seen.add(reply.toLowerCase()))
    .slice(0, 3)
}

/** Asks her server for replies to her answer. Never throws: without an answer there are none. */
export async function fetchDahliaReplies(turn: { said: string, answer: string }, headers: HeadersInit, signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await fetch(`${SERVER_URL}/api/v1/dahlia/suggestions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ said: turn.said.slice(0, 1500), answer: turn.answer.slice(0, 1500) }),
      signal: signal ?? AbortSignal.timeout(60_000),
    })
    if (!response.ok)
      return []
    return cleanDahliaReplies((await response.json() as { replies?: unknown }).replies)
  }
  catch {
    return []
  }
}
