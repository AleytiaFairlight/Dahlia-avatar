import type { WebSocketEvent } from '@proj-airi/server-sdk'

import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface WebSocketHistoryItem {
  id: string
  timestamp: number
  direction: 'incoming' | 'outgoing'
  event: WebSocketEvent
}

// Dahlia: the inspector keeps up to 1000 events and shows them on a settings page, so the token of
// module:authenticate is hidden before an event is stored.
function redactSecrets(event: WebSocketEvent): WebSocketEvent {
  const { type, data } = event as { type?: string, data?: unknown }
  if (type === 'module:authenticate' && data && typeof data === 'object' && 'token' in data)
    return { ...event, data: { ...data, token: '[redacted]' } } as WebSocketEvent

  return event
}

export const useWebSocketInspectorStore = defineStore('devtools:websocket-inspector', () => {
  const history = ref<WebSocketHistoryItem[]>([])
  const isEnabled = ref(true)
  const maxHistory = ref(1000)

  function add(direction: 'incoming' | 'outgoing', event: WebSocketEvent) {
    if (!isEnabled.value)
      return

    history.value.unshift({
      id: nanoid(),
      timestamp: Date.now(),
      direction,
      event: redactSecrets(event),
    })

    if (history.value.length > maxHistory.value) {
      history.value.pop()
    }
  }

  function clear() {
    history.value = []
  }

  return {
    history,
    isEnabled,
    maxHistory,
    add,
    clear,
  }
})
