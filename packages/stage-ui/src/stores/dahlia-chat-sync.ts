// Dahlia: the apps' chats are the same on every device. AIRI's chat sync (its cloud sync, which needs an AIRI
// account) runs against Dahlia's server instead (src/Dahlia.Avatar/Gateway/ChatSync.cs), signed in with the
// voice-checked session (stores/dahlia-auth.ts): the chat store's user is the person the Dahlia key belongs
// to, such as the owner, so each person has their own chats. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh makes stores/chat/session-store.ts use it.

import type { ChatSessionMeta, ChatSessionsIndex } from '../types/chat-session'

import { computed } from 'vue'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { useDahliaAuth } from './dahlia-auth'

/** The user of the chats kept on the device before they synchronized. */
const LOCAL_USER_ID = 'local'

/**
 * The chat store's identity: the person of the Dahlia key, once the server said who it is; the session
 * signs in to the chats. Without a key, or before that, the chats stay local.
 */
export function useDahliaChatIdentity() {
  const { me, session } = useDahliaAuth()
  const userId = computed(() => me.value?.id ?? LOCAL_USER_ID)
  const token = computed<string | null>(() => session.value ?? null)
  return { userId, token }
}

/** A fetch for the chats API with the Dahlia key, in place of AIRI's signed-in fetch. */
export function createDahliaChatFetch(getKey: () => string | null): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    const key = getKey()
    if (key)
      headers.set('Authorization', `Bearer ${key}`)
    return fetch(input, { ...init, headers })
  }
}

/**
 * The chats kept on this device while it didn't know whose they are (the "local" user) move to the signed-in
 * person: on every start, those not moved yet, so chats from before a sign-in and from times the app didn't know
 * the person stay visible and synchronize. The copies under the local user stay as they were.
 */
export async function moveLocalChatsToDahlia(userId: string, repo: Pick<typeof chatSessionsRepo, 'getIndex' | 'saveIndex' | 'getSession' | 'saveSession'> = chatSessionsRepo) {
  if (userId === LOCAL_USER_ID)
    return

  const local = await repo.getIndex(LOCAL_USER_ID)
  if (!local)
    return

  const target: ChatSessionsIndex = await repo.getIndex(userId) ?? { userId, characters: {} }
  let moved = false
  for (const [characterId, character] of Object.entries(local.characters)) {
    const targetCharacter = target.characters[characterId] ?? { ...character, sessions: {} }
    for (const [sessionId, meta] of Object.entries(character.sessions)) {
      if (Object.values(target.characters).some(c => c.sessions[sessionId]))
        continue
      targetCharacter.sessions[sessionId] = { ...meta, userId }
      const record = await repo.getSession(sessionId)
      if (record)
        await repo.saveSession(sessionId, { ...record, meta: { ...record.meta, userId } })
      moved = true
    }
    if (!targetCharacter.activeSessionId)
      targetCharacter.activeSessionId = character.activeSessionId
    target.characters[characterId] = targetCharacter
  }
  if (moved)
    await repo.saveIndex(target)
}

const BACKFILLED_KEY = 'dahlia/chat-backfilled'

function backfilled(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(BACKFILLED_KEY) ?? '[]') as string[])
  }
  catch {
    return new Set()
  }
}

/** One message to send to the server again. */
export interface DahliaBackfillMessage {
  id?: string
  role: string
  createdAt?: number
}

/**
 * After the chats are matched with the server's, each synchronized chat sends all of its messages once on this
 * device: messages written while the app didn't know whose chats these are never reached the server, and the
 * server keeps one copy of each message id. Chats without lastMessageAt get it from their messages, so every
 * window can follow the chat that was spoken in last.
 */
export async function backfillDahliaChats<M extends DahliaBackfillMessage>(options: {
  metas: () => ChatSessionMeta[]
  userId: string
  staysLocal: (meta: ChatSessionMeta) => boolean
  messagesOf: (sessionId: string) => Promise<M[]>
  enqueue: (meta: ChatSessionMeta, message: M) => Promise<void>
  setLastMessageAt: (sessionId: string, lastMessageAt: number) => void
}) {
  const done = backfilled()
  let changed = false
  for (const meta of options.metas()) {
    if (meta.userId !== options.userId || !meta.cloudChatId || options.staysLocal(meta))
      continue
    const sendAll = !done.has(meta.sessionId)
    if (!sendAll && meta.lastMessageAt)
      continue

    const messages = await options.messagesOf(meta.sessionId)
    if (!meta.lastMessageAt) {
      const latest = latestMessageAt(messages)
      if (latest)
        options.setLastMessageAt(meta.sessionId, latest)
    }
    if (sendAll) {
      for (const message of messages)
        await options.enqueue(meta, message)
      done.add(meta.sessionId)
      changed = true
    }
  }
  if (changed) {
    try {
      localStorage.setItem(BACKFILLED_KEY, JSON.stringify([...done].slice(-500)))
    }
    catch {}
  }
}

/** When the newest of these messages was written, or undefined when none says. */
export function latestMessageAt(messages: ReadonlyArray<{ createdAt?: number }>): number | undefined {
  let latest: number | undefined
  for (const message of messages) {
    if (typeof message.createdAt === 'number' && (latest === undefined || message.createdAt > latest))
      latest = message.createdAt
  }
  return latest
}

/**
 * The chat of a character that was spoken in last, on any device: the conversation continues there. Branches,
 * tasks and recipe spaces don't count.
 */
export function newestDahliaChat(metas: ReadonlyArray<ChatSessionMeta>, userId: string, characterId: string): string | undefined {
  let newest: ChatSessionMeta | undefined
  for (const meta of metas) {
    if (meta.userId !== userId || meta.characterId !== characterId || meta.hidden || meta.task || meta.recipeId || meta.parentSessionId || !meta.lastMessageAt)
      continue
    if (!newest || meta.lastMessageAt! > newest.lastMessageAt!)
      newest = meta
  }
  return newest?.sessionId
}

interface ChatSocket {
  status: () => string
  connect: () => void
}

let socketOf: (() => ChatSocket | undefined) | undefined
let hasSession: () => boolean = () => false

/**
 * Connects the chat socket again when it closed and the app has a session: when the app comes back to the
 * front (a phone pauses it), when the network returns, and every minute. The socket otherwise stays closed
 * after the server ended a session that ran out.
 */
export function keepDahliaChatConnected(socket: () => ChatSocket | undefined, session: () => boolean) {
  const started = socketOf !== undefined
  socketOf = socket
  hasSession = session
  if (started || typeof window === 'undefined')
    return

  const nudge = () => {
    const current = socketOf?.()
    if (current && hasSession() && current.status() === 'closed')
      current.connect()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
      nudge()
  })
  window.addEventListener('online', nudge)
  setInterval(nudge, 60_000)
}
