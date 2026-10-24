// Dahlia: the apps' chats are the same on every device. AIRI's chat sync (its cloud sync, which needs an AIRI
// account) runs against Dahlia's server instead (src/Dahlia.Avatar/Gateway/ChatSync.cs), signed in with the
// voice-checked session (stores/dahlia-auth.ts): the chat store's user is the person the Dahlia key belongs
// to, such as the owner, so each person has their own chats. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh makes stores/chat/session-store.ts use it.

import type { ChatSessionsIndex } from '../types/chat-session'

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
 * The chats kept on this device before chat sync move to the signed-in person once, so they stay visible
 * and synchronize. The copies under the local user stay as they were.
 */
export async function moveLocalChatsToDahlia(userId: string, repo: Pick<typeof chatSessionsRepo, 'getIndex' | 'saveIndex' | 'getSession' | 'saveSession'> = chatSessionsRepo) {
  if (userId === LOCAL_USER_ID || await repo.getIndex(userId))
    return

  const local = await repo.getIndex(LOCAL_USER_ID)
  if (!local)
    return

  const moved: ChatSessionsIndex = { userId, characters: {} }
  for (const [characterId, character] of Object.entries(local.characters)) {
    const sessions: typeof character.sessions = {}
    for (const [sessionId, meta] of Object.entries(character.sessions)) {
      sessions[sessionId] = { ...meta, userId }
      const record = await repo.getSession(sessionId)
      if (record)
        await repo.saveSession(sessionId, { ...record, meta: { ...record.meta, userId } })
    }
    moved.characters[characterId] = { ...character, sessions }
  }
  await repo.saveIndex(moved)
}
