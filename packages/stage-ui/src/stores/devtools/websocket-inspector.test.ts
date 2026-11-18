import type { WebSocketEvent } from '@proj-airi/server-sdk'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useWebSocketInspectorStore } from './websocket-inspector'

describe('websocket inspector', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // Dahlia: the history shows on a settings page, so it never holds the pairing token.
  it('hides the token of module:authenticate', () => {
    const inspector = useWebSocketInspectorStore()
    inspector.add('outgoing', { type: 'module:authenticate', data: { token: 'secret-token' } } as unknown as WebSocketEvent)

    expect(JSON.stringify(inspector.history)).not.toContain('secret-token')
    expect((inspector.history[0].event as unknown as { data: { token: string } }).data.token).toBe('[redacted]')
  })

  it('keeps other events as they are', () => {
    const inspector = useWebSocketInspectorStore()
    const event = { type: 'context:update', data: { text: 'hi' } } as unknown as WebSocketEvent
    inspector.add('incoming', event)

    expect(inspector.history[0].event).toEqual(event)
  })
})
