// Dahlia: tests for dahlia-memory.ts: her memory is on her server, so the apps' own memory goes off once, and what
// AIRI kept on a device moves to the server without being lost or sent twice.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DAHLIA_SERVER_MEMORY_KEY, deviceMemoryText, moveDeviceMemories, useDahliaServerMemoryOnce } from './dahlia-memory'

const { memory, repo, session } = vi.hoisted(() => ({
  memory: { enabled: true },
  repo: { entries: [] as { id: string, description: string, body: string, updatedAt: number }[], removed: [] as string[] },
  session: { value: 'session-token' as string | undefined },
}))
vi.mock('./memory', () => ({ useMemoryStore: () => memory }))
vi.mock('../database/repos/memory.repo', () => ({
  memoryRepo: {
    list: async () => repo.entries.filter(entry => !repo.removed.includes(entry.id)),
    remove: async (ids: string[]) => void repo.removed.push(...ids),
  },
}))
vi.mock('./dahlia-auth', () => ({
  dahliaSession: () => session.value,
  dahliaHeaders: (extra: Record<string, string>) => ({ Authorization: `Bearer ${session.value}`, ...extra }),
  useDahliaAuth: () => ({}),
}))

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
})

describe('dahlia server memory', () => {
  beforeEach(() => {
    repo.entries = []
    repo.removed = []
    session.value = 'session-token'
  })

  it('turns the apps\' own memory off once', () => {
    useDahliaServerMemoryOnce()
    expect(memory.enabled).toBe(false)
    expect(storage.get(DAHLIA_SERVER_MEMORY_KEY)).toBe('true')

    memory.enabled = true
    useDahliaServerMemoryOnce()
    expect(memory.enabled).toBe(true)
  })

  it('says a memory from the device in one text, with its index line only when the fact lacks it', () => {
    expect(deviceMemoryText({ description: 'When she talks about pets', body: 'Aleytia has a cat named Miso.' })).toBe('When she talks about pets: Aleytia has a cat named Miso.')
    expect(deviceMemoryText({ description: 'Aleytia likes tea', body: 'aleytia likes tea, green mostly.' })).toBe('aleytia likes tea, green mostly.')
    expect(deviceMemoryText({ description: '', body: ' Plays Dark War. ' })).toBe('Plays Dark War.')
  })

  it('moves the device\'s memories to her server, removing each only once the server has it', async () => {
    repo.entries = [
      { id: 'a', description: '', body: 'Aleytia streams on Fridays.', updatedAt: 1 },
      { id: 'b', description: '', body: 'Aleytia has a cat named Miso.', updatedAt: 2 },
    ]
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).text)
      return new Response('{}', { status: sent.length === 2 ? 500 : 200 })
    }))

    await expect(moveDeviceMemories()).rejects.toThrow()
    expect(sent).toEqual(['Aleytia streams on Fridays.', 'Aleytia has a cat named Miso.'])
    expect(repo.removed).toEqual(['a'])

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    expect(await moveDeviceMemories()).toBe(1)
    expect(repo.removed).toEqual(['a', 'b'])
    expect(await moveDeviceMemories()).toBe(0)
  })

  it('moves nothing before the voice check', async () => {
    repo.entries = [{ id: 'a', description: '', body: 'Aleytia streams on Fridays.', updatedAt: 1 }]
    session.value = undefined
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    expect(await moveDeviceMemories()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(repo.removed).toEqual([])
  })
})
