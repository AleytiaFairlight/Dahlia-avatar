// @vitest-environment jsdom
// Dahlia: tests for dahlia-chat-sync.ts, the apps' chats on Dahlia's server.
import type { ChatSessionMeta } from '../types/chat-session'

import { describe, expect, it, vi } from 'vitest'

import { keepDahliaChatConnected, latestMessageAt, newestDahliaChat } from './dahlia-chat-sync'

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
})
