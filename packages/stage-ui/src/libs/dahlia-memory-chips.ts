// Dahlia: which of her memories she had in mind for a reply, and a search of her memories from the chat. Her server
// chooses memories for each message it answers; once a reply ends, the chat asks which ones went into it
// (POST /api/v1/dahlia/memories/used) and keeps them with the reply, where they show as chips. The search asks her
// recall (GET /api/v1/dahlia/memories/search). Both need the voice-checked session, like her memory list. After the
// memory chips and memory search of dasilva333/airi; the code is Dahlia's. This file is Dahlia's (AIRI has no such file).

import type { ChatAssistantMessage, ChatHistoryItem, DahliaUsedMemory } from '../types/chat'

import { dahliaHeaders, dahliaKey } from '../stores/dahlia-auth'
import { SERVER_URL } from './server'

/** "false" when the person turned the chips off (Settings > Dahlia); on otherwise. */
export const DAHLIA_MEMORY_CHIPS_KEY = 'dahlia/memory-chips'

/** A memory her search found: a memory she had in mind, with its id. */
export interface DahliaFoundMemory extends DahliaUsedMemory {
  id: number
}

export function dahliaMemoryChipsEnabled() {
  try {
    return localStorage.getItem(DAHLIA_MEMORY_CHIPS_KEY) !== 'false'
  }
  catch {
    return true
  }
}

async function readMemories<T extends DahliaUsedMemory>(response: Response): Promise<T[]> {
  if (!response.ok) {
    const answer = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined
    throw new Error(answer?.error?.message ?? `Dahlia's server answered ${response.status}.`)
  }
  const answer = await response.json() as { memories?: T[] }
  return Array.isArray(answer.memories) ? answer.memories.filter(memory => typeof memory?.text === 'string') : []
}

/** The memories her server used for the message that holds `text`. */
export async function fetchDahliaUsedMemories(text: string, signal?: AbortSignal, serverUrl = SERVER_URL, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
  const response = await fetcher(`${serverUrl}/api/v1/dahlia/memories/used`, {
    method: 'POST',
    headers: dahliaHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text }),
    signal,
  })
  return (await readMemories<DahliaUsedMemory>(response)).map(({ kind, text, at, speaker }) => ({ kind, text, at, speaker }))
}

/** Her memories that match `query`, best first. */
export async function searchDahliaMemories(query: string, signal?: AbortSignal, serverUrl = SERVER_URL, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
  const response = await fetcher(`${serverUrl}/api/v1/dahlia/memories/search?q=${encodeURIComponent(query)}`, { headers: dahliaHeaders(), signal })
  return await readMemories<DahliaFoundMemory>(response)
}

/** What kind of memory it is, in a word or two, for a chip. */
export function dahliaMemoryKindLabel(kind: string) {
  switch (kind) {
    case 'fact':
      return 'Fact'
    case 'conversation':
      return 'Talk'
    case 'turn':
      return 'Said'
    case 'dream':
      return 'Dream'
    case 'game':
      return 'Game'
    default:
      return 'Memory'
  }
}

/** The text the person typed in a message, without its attachments. */
export function dahliaMessageText(message: ChatHistoryItem | undefined) {
  if (!message || message.role !== 'user')
    return ''
  if (typeof message.content === 'string')
    return message.content.trim()
  return message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').trim()
}

export interface DahliaMemoryChipsDeps {
  onAssistantResponseEnd: (hook: (message: string, context: { sessionId: string, message: ChatHistoryItem }) => Promise<void>) => () => void
  messages: (sessionId: string) => ChatHistoryItem[] | undefined
  store: (sessionId: string, message: ChatAssistantMessage & { id: string }) => Promise<void>
  fetch?: (text: string) => Promise<DahliaUsedMemory[]>
  enabled?: () => boolean
}

/** Keeps the memories her server used with each reply, once the reply ends. Returns the stop. */
export function startDahliaMemoryChips(deps: DahliaMemoryChipsDeps) {
  const enabled = deps.enabled ?? dahliaMemoryChipsEnabled
  const fetchUsed = deps.fetch ?? (text => fetchDahliaUsedMemories(text))
  return deps.onAssistantResponseEnd(async (_answer, context) => {
    const said = dahliaMessageText(context.message)
    if (!said || !enabled() || !dahliaKey())
      return
    let memories: DahliaUsedMemory[]
    try {
      memories = await fetchUsed(said)
    }
    catch {
      // Without a voice-checked session or her server, the reply goes without chips.
      return
    }
    if (memories.length === 0)
      return

    // Her reply is the first message of hers after the one she answered.
    const messages = deps.messages(context.sessionId) ?? []
    const asked = messages.findIndex(message => message.id !== undefined && message.id === context.message.id)
    const reply = asked < 0 ? undefined : messages.slice(asked + 1).find(message => message.role === 'assistant')
    if (reply?.role !== 'assistant' || !reply.id)
      return
    await deps.store(context.sessionId, { ...reply, id: reply.id, memories })
  })
}
