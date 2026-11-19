import type { ChatAssistantMessage, ChatHistoryItem } from '../types/chat'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dahliaMessageText, startDahliaMemoryChips } from './dahlia-memory-chips'

vi.mock('../stores/dahlia-auth', () => ({ dahliaKey: () => 'key', dahliaHeaders: () => ({}) }))

type Hook = (message: string, context: { sessionId: string, message: ChatHistoryItem }) => Promise<void>

describe('dahlia memory chips', () => {
  let hook: Hook
  const stored: Array<ChatAssistantMessage & { id: string }> = []
  const asked: ChatHistoryItem = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'How is my cat?' }] }
  const messages: ChatHistoryItem[] = [
    { id: 'a0', role: 'assistant', content: 'Earlier.', slices: [], tool_results: [] },
    asked,
    { id: 'a1', role: 'assistant', content: 'Miso is fine!', slices: [], tool_results: [] },
  ]

  beforeEach(() => {
    stored.length = 0
  })

  function start(found: Array<{ kind: string, text: string }> | Error) {
    const fetch = vi.fn(async () => {
      if (found instanceof Error)
        throw found
      return found
    })
    startDahliaMemoryChips({
      onAssistantResponseEnd: (registered) => {
        hook = registered
        return () => {}
      },
      messages: () => messages,
      store: async (_session, message) => {
        stored.push(message)
      },
      fetch,
      enabled: () => true,
    })
    return fetch
  }

  it('keeps the memories with her reply to the message, not with an earlier one', async () => {
    const fetch = start([{ kind: 'fact', text: 'Aleytia has a cat named Miso.' }])
    await hook('Miso is fine!', { sessionId: 's1', message: asked })

    expect(fetch).toHaveBeenCalledWith('How is my cat?')
    expect(stored).toEqual([{ ...messages[2], memories: [{ kind: 'fact', text: 'Aleytia has a cat named Miso.' }] }])
  })

  it('leaves her reply as it is without memories or without her server', async () => {
    start([])
    await hook('Miso is fine!', { sessionId: 's1', message: asked })
    start(new Error('403'))
    await hook('Miso is fine!', { sessionId: 's1', message: asked })

    expect(stored).toEqual([])
    expect(dahliaMessageText({ role: 'user', content: '  hi  ' })).toBe('hi')
  })
})
