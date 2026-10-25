// @vitest-environment jsdom
// Dahlia: tests for dahlia-chat-sync.ts, the apps' chats on Dahlia's server.
import type { ChatSessionMeta } from '../types/chat-session'

import { describe, expect, it, vi } from 'vitest'

import { backfillDahliaChats, keepDahliaChatConnected, latestMessageAt, moveLocalChatsToDahlia, newestDahliaChat } from './dahlia-chat-sync'

vi.mock('../database/repos/chat-sessions.repo', () => ({ chatSessionsRepo: {} }))
vi.mock('./dahlia-auth', () => ({ useDahliaAuth: () => ({}) }))

function meta(sessionId: string, lastMessageAt: number | undefined, extra: Partial<ChatSessionMeta> = {}): ChatSessionMeta {
  return { sessionId, userId: 'owner', characterId: 'default', createdAt: 0, updatedAt: 0, lastMessageAt, ...extra }
}

describe('dahlia chat sync', () => {
  it('knows when the newest message was written', () => {
    expect(latestMessageAt([{ createdAt: 5 }, {}, { createdAt: 9 }, { createdAt: 7 }])).toBe(9)
    expect(latestMessageAt([{}])).toBeUndefined()
  })

  it('follows the chat that was spoken in last, of the person and character', () => {
    const metas = [
      meta('phone-chat', 300),
      meta('pc-chat', 200),
      meta('empty', undefined),
      meta('branch', 900, { parentSessionId: 'pc-chat' }),
      meta('task', 900, { hidden: true }),
      meta('other-character', 900, { characterId: 'other' }),
      meta('someone-else', 900, { userId: 'u1' }),
    ]
    expect(newestDahliaChat(metas, 'owner', 'default')).toBe('phone-chat')
    expect(newestDahliaChat([meta('empty', undefined)], 'owner', 'default')).toBeUndefined()
  })

  it('connects the socket again when the app comes back and has a session', () => {
    const socket = { status: vi.fn(() => 'closed'), connect: vi.fn() }
    let session = false
    keepDahliaChatConnected(() => socket, () => session)

    document.dispatchEvent(new Event('visibilitychange'))
    expect(socket.connect).not.toHaveBeenCalled()

    session = true
    window.dispatchEvent(new Event('online'))
    expect(socket.connect).toHaveBeenCalledOnce()

    socket.status.mockReturnValue('open')
    window.dispatchEvent(new Event('online'))
    expect(socket.connect).toHaveBeenCalledOnce()
  })

  it('moves the chats of the local user that aren\'t moved yet, on every start', async () => {
    const indexes: Record<string, any> = {
      local: { userId: 'local', characters: { default: { activeSessionId: 'b', sessions: { a: meta('a', 1, { userId: 'local' }), b: meta('b', 2, { userId: 'local' }) } } } },
      owner: { userId: 'owner', characters: { default: { activeSessionId: 'a', sessions: { a: meta('a', 1) } } } },
    }
    const records: Record<string, any> = { a: { meta: meta('a', 1, { userId: 'local' }), messages: [] }, b: { meta: meta('b', 2, { userId: 'local' }), messages: [{ id: 'm1' }] } }
    const repo = {
      getIndex: async (userId: string) => indexes[userId],
      saveIndex: async (index: any) => indexes[index.userId] = index,
      getSession: async (id: string) => records[id],
      saveSession: async (id: string, record: any) => records[id] = record,
    }

    await moveLocalChatsToDahlia('owner', repo as never)

    expect(Object.keys(indexes.owner.characters.default.sessions)).toEqual(['a', 'b'])
    expect(indexes.owner.characters.default.sessions.b.userId).toBe('owner')
    expect(indexes.owner.characters.default.activeSessionId).toBe('a')
    expect(records.b.meta.userId).toBe('owner')
  })

  it('sends each synchronized chat once, and dates chats by their newest message', async () => {
    localStorage.removeItem('dahlia/chat-backfilled')
    const metas = [
      meta('synced', undefined, { cloudChatId: 'c1' }),
      meta('dated', 50, { cloudChatId: 'c2' }),
      meta('local-only', undefined),
      meta('scene', undefined, { cloudChatId: 'c3', bindings: ['x'] }),
    ]
    const sent: string[] = []
    const dated: Record<string, number> = {}
    const run = () => backfillDahliaChats({
      metas: () => metas,
      userId: 'owner',
      staysLocal: m => !!m.bindings?.length,
      messagesOf: async id => [{ id: `${id}-1`, role: 'user', createdAt: 10 }, { id: `${id}-2`, role: 'assistant', createdAt: 20 }],
      enqueue: async (m, message) => void sent.push(`${m.sessionId}:${message.id}`),
      setLastMessageAt: (id, at) => dated[id] = at,
    })

    await run()
    expect(sent).toEqual(['synced:synced-1', 'synced:synced-2', 'dated:dated-1', 'dated:dated-2'])
    expect(dated).toEqual({ synced: 20 })

    sent.length = 0
    await run()
    expect(sent).toEqual([])
  })
})
