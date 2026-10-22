// Dahlia: tests for dahlia-memory.ts: her memory is on her server, so the apps' own memory goes off once.
import { describe, expect, it, vi } from 'vitest'

import { DAHLIA_SERVER_MEMORY_KEY, useDahliaServerMemoryOnce } from './dahlia-memory'

const { memory } = vi.hoisted(() => ({ memory: { enabled: true } }))
vi.mock('./memory', () => ({ useMemoryStore: () => memory }))

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
})

describe('dahlia server memory', () => {
  it('turns the apps\' own memory off once', () => {
    useDahliaServerMemoryOnce()
    expect(memory.enabled).toBe(false)
    expect(storage.get(DAHLIA_SERVER_MEMORY_KEY)).toBe('true')

    memory.enabled = true
    useDahliaServerMemoryOnce()
    expect(memory.enabled).toBe(true)
  })
})
