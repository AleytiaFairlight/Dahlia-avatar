// Dahlia: finishes a reply the app didn't stay to read. A long turn (tens of minutes on the split
// model) can outlive the app: backgrounded, offline, killed. The hub keeps such a turn running detached
// and holds the finished reply for pick-up (GET /api/v1/dahlia/turn?key=, same key the app sent the turn
// with). When the app comes back, pending turns are asked for and their finished text replaces the partial
// bubble, which is then synced to the cloud like any other edit. This file is Dahlia's.

import { DAHLIA_CHAT_PROVIDER_ID } from '../libs/providers/providers/dahlia'

/** The request header that keys a turn for pick-up when its app comes back. */
export const DAHLIA_TURN_KEY_HEADER = 'X-Dahlia-Turn-Key'

/** Whether the provider is Dahlia's own (the only one whose hub finishes turns detached). */
export function isDahliaTurnProvider(providerId: string | undefined): boolean {
  return providerId === DAHLIA_CHAT_PROVIDER_ID
}

/** The pick-up header for a Dahlia turn, or nothing for other providers and untracked requests. */
export function dahliaTurnHeaders(providerId: string | undefined, turnId?: string): Record<string, string> {
  return isDahliaTurnProvider(providerId) && turnId ? { [DAHLIA_TURN_KEY_HEADER]: turnId } : {}
}

export interface DahliaPendingTurn {
  sessionId: string
  turnKey: string
  notedAt: number
}

export interface DahliaResumeDeps {
  /** The Dahlia key, as used for the chat request. */
  getKey: () => string | null
  /** GET ${serverUrl}/api/v1/dahlia/turn?key= — 200 {status, text}, 202 running, 404/410 gone. */
  serverUrl: string
  /** Pending turns the app streamed without a finish. */
  listPending: () => DahliaPendingTurn[]
  /** Forget a turn: it finished locally, failed, or is gone server-side. */
  clearPending: (turnKey: string) => void
  /** Replace the partial assistant bubble of a turn with its finished text. */
  applyFinished: (sessionId: string, turnKey: string, text: string) => Promise<boolean>
  fetchImpl?: typeof fetch
}

const pending = new Map<string, { sessionId: string, notedAt: number }>()

/** A stream ended (error, abort) with partial text and no finish: keep its key for pick-up. */
export function noteDahliaUnfinishedTurn(sessionId: string, turnKey: string): void {
  if (!turnKey)
    return
  pending.set(turnKey, { sessionId, notedAt: Date.now() })
}

/** A turn finished locally (or was picked up): nothing to resume. */
export function clearDahliaFinishedTurn(turnKey: string): void {
  pending.delete(turnKey)
}

export function listDahliaPendingTurns(): DahliaPendingTurn[] {
  return [...pending.entries()].map(([turnKey, v]) => ({ turnKey, sessionId: v.sessionId, notedAt: v.notedAt }))
}

export type DahliaTurnStatus = { status: 'finished', text: string } | { status: 'running' } | { status: 'gone' }

export interface DahliaTurnMessage { id?: string, role?: string, content?: unknown }

export interface DahliaTurnResumerDeps<TMessage extends DahliaTurnMessage = DahliaTurnMessage> {
  serverUrl: string
  getKey: () => string | null
  getMessages: (sessionId: string) => readonly TMessage[] | undefined
  replaceHistory: (sessionId: string, messages: TMessage[]) => Promise<void> | void
  pushToCloud: (sessionId: string, message: { id: string, role: 'assistant', content: string }) => Promise<void> | void
  canSync: (sessionId: string) => boolean
}

/**
 * Applies a detached turn's finished text to its partial bubble and syncs it like any other edit, so the
 * reply that arrived while the app was away replaces the cut-off one everywhere. The bubble is the first
 * assistant message after the turn's user message.
 */
export function createDahliaTurnResumer<TMessage extends DahliaTurnMessage = DahliaTurnMessage>(deps: DahliaTurnResumerDeps<TMessage>) {
  async function applyFinished(sessionId: string, turnKey: string, text: string): Promise<boolean> {
    const messages = deps.getMessages(sessionId)
    if (!messages)
      return false
    const userIndex = messages.findIndex(message => message.id === turnKey)
    if (userIndex < 0)
      return false
    const assistantIndex = messages.findIndex((message, index) => index > userIndex && message.role === 'assistant')
    if (assistantIndex < 0)
      return false
    const target = messages[assistantIndex]
    if (!target.id)
      return false
    await deps.replaceHistory(sessionId, messages.map((message, index) => index === assistantIndex ? { ...message, content: text } : { ...message }))
    if (deps.canSync(sessionId))
      await deps.pushToCloud(sessionId, { id: target.id, role: 'assistant', content: text })
    return true
  }

  async function resume(): Promise<void> {
    if (listDahliaPendingTurns().length === 0)
      return
    await resumeDahliaPendingTurns({
      serverUrl: deps.serverUrl,
      getKey: deps.getKey,
      listPending: listDahliaPendingTurns,
      clearPending: clearDahliaFinishedTurn,
      applyFinished,
    })
  }

  return { applyFinished, resume }
}

/** Asks the hub for one turn: finished with its text, still running, or gone (unknown/failed/expired). */
export async function fetchDahliaTurnResult(serverUrl: string, key: string, turnKey: string, fetchImpl: typeof fetch = fetch): Promise<DahliaTurnStatus> {
  const response = await fetchImpl(`${serverUrl}/api/v1/dahlia/turn?key=${encodeURIComponent(turnKey)}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  })
  if (response.status === 200) {
    const body = await response.json() as { status?: unknown, text?: unknown }
    if (body.status === 'finished' && typeof body.text === 'string' && body.text.length > 0)
      return { status: 'finished', text: body.text }
    return { status: 'gone' }
  }
  if (response.status === 202)
    return { status: 'running' }
  return { status: 'gone' }
}

/**
 * Asks the hub for every pending turn and applies the finished ones. A turn still running stays pending;
 * a gone one is forgotten (the partial bubble stays, as before). Returns how many finished.
 */
export async function resumeDahliaPendingTurns(deps: DahliaResumeDeps): Promise<number> {
  let finished = 0
  for (const { sessionId, turnKey } of deps.listPending()) {
    const key = deps.getKey()
    if (!key)
      return finished
    let result: DahliaTurnStatus
    try {
      result = await fetchDahliaTurnResult(deps.serverUrl, key, turnKey, deps.fetchImpl)
    }
    catch {
      return finished
    }
    if (result.status === 'running')
      continue
    deps.clearPending(turnKey)
    if (result.status !== 'finished')
      continue
    try {
      if (await deps.applyFinished(sessionId, turnKey, result.text))
        finished += 1
    }
    catch {
      // A later refocus tries again only if still pending; re-note it.
      noteDahliaUnfinishedTurn(sessionId, turnKey)
    }
  }
  return finished
}

let started = false

/**
 * Keeps finished turns coming home: whenever the app comes back to the front, comes online, and every
 * minute, pending turns are asked for. Mirrors keepDahliaChatConnected (phones pause the app).
 */
export function startDahliaTurnResume(resume: () => void): void {
  if (started || typeof window === 'undefined')
    return
  started = true
  const nudge = () => resume()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
      nudge()
  })
  window.addEventListener('online', nudge)
  setInterval(nudge, 60_000)
}
