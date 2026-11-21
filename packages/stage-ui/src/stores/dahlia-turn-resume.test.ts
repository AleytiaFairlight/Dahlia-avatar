// @vitest-environment jsdom
// Dahlia: tests for dahlia-turn-resume.ts — finished turns picked up after the app comes back.
import { describe, expect, it, vi } from 'vitest'

import {
  clearDahliaFinishedTurn,
  createDahliaTurnResumer,
  dahliaTurnHeaders,
  DAHLIA_TURN_KEY_HEADER,
  fetchDahliaTurnResult,
  isDahliaTurnProvider,
  listDahliaPendingTurns,
  noteDahliaUnfinishedTurn,
  resumeDahliaPendingTurns,
} from './dahlia-turn-resume'

describe('dahlia turn resume', () => {
  it('sends the turn key only for Dahlia turns', () => {
    expect(dahliaTurnHeaders('dahlia', 'u1')).toEqual({ [DAHLIA_TURN_KEY_HEADER]: 'u1' })
    expect(dahliaTurnHeaders('dahlia', undefined)).toEqual({})
    expect(dahliaTurnHeaders('official-provider-openai', 'u1')).toEqual({})
    expect(dahliaTurnHeaders(undefined, 'u1')).toEqual({})
    expect(isDahliaTurnProvider('dahlia')).toBe(true)
    expect(isDahliaTurnProvider('other')).toBe(false)
  })

  it('tracks unfinished turns until they finish', () => {
    noteDahliaUnfinishedTurn('s1', 'u1')
    noteDahliaUnfinishedTurn('s1', 'u2')
    expect(listDahliaPendingTurns()).toHaveLength(2)
    clearDahliaFinishedTurn('u1')
    expect(listDahliaPendingTurns().map(p => p.turnKey)).toEqual(['u2'])
    clearDahliaFinishedTurn('u2')
    expect(listDahliaPendingTurns()).toHaveLength(0)
  })

  function deps(overrides: Record<string, unknown> = {}) {
    return {
      serverUrl: 'https://dahlia.test',
      getKey: () => 'key',
      listPending: () => listDahliaPendingTurns(),
      clearPending: clearDahliaFinishedTurn,
      applyFinished: vi.fn(async () => true),
      fetchImpl: vi.fn(),
      ...overrides,
    }
  }

  it('applies a finished turn and forgets it', async () => {
    noteDahliaUnfinishedTurn('s1', 'u9')
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'finished', text: 'the whole reply' }), { status: 200 }))
    const applyFinished = vi.fn(async () => true)
    const finished = await resumeDahliaPendingTurns({ ...deps(), fetchImpl, applyFinished })
    expect(finished).toBe(1)
    expect(applyFinished).toHaveBeenCalledWith('s1', 'u9', 'the whole reply')
    expect(listDahliaPendingTurns()).toHaveLength(0)
  })

  it('leaves a running turn pending', async () => {
    noteDahliaUnfinishedTurn('s1', 'u8')
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'running' }), { status: 202 }))
    const applyFinished = vi.fn(async () => true)
    expect(await resumeDahliaPendingTurns({ ...deps(), fetchImpl, applyFinished })).toBe(0)
    expect(applyFinished).not.toHaveBeenCalled()
    expect(listDahliaPendingTurns().map(p => p.turnKey)).toEqual(['u8'])
    clearDahliaFinishedTurn('u8')
  })

  it('forgets a gone turn without applying', async () => {
    noteDahliaUnfinishedTurn('s1', 'u7')
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }))
    const applyFinished = vi.fn(async () => true)
    expect(await resumeDahliaPendingTurns({ ...deps(), fetchImpl, applyFinished })).toBe(0)
    expect(applyFinished).not.toHaveBeenCalled()
    expect(listDahliaPendingTurns()).toHaveLength(0)
  })

  it('reads the turn endpoint shapes', async () => {
    const ok = async (status: number, body: unknown) => fetchDahliaTurnResult('https://dahlia.test', 'key', 'u1', (async () => new Response(JSON.stringify(body), { status })) as typeof fetch)
    expect(await ok(200, { status: 'finished', text: 'hi' })).toEqual({ status: 'finished', text: 'hi' })
    expect(await ok(200, { status: 'finished', text: '' })).toEqual({ status: 'gone' })
    expect(await ok(202, {})).toEqual({ status: 'running' })
    expect(await ok(404, {})).toEqual({ status: 'gone' })
    expect(await ok(410, {})).toEqual({ status: 'gone' })
  })

  it('applies a finished turn over its partial bubble and syncs it', async () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', content: 'Hel' },
    ]
    let pushed: unknown = null
    const resumer = createDahliaTurnResumer({
      serverUrl: 'https://dahlia.test',
      getKey: () => 'key',
      getMessages: () => messages,
      replaceHistory: (_sessionId, next) => {
        messages.splice(0, messages.length, ...next)
      },
      pushToCloud: (_sessionId, message) => {
        pushed = message
      },
      canSync: () => true,
    })
    expect(await resumer.applyFinished('s1', 'u1', 'Hello there.')).toBe(true)
    expect(messages[1]).toMatchObject({ id: 'a1', content: 'Hello there.' })
    expect(pushed).toEqual({ id: 'a1', role: 'assistant', content: 'Hello there.' })
  })

  it('ignores finished text with nowhere to put it', async () => {
    const resumer = createDahliaTurnResumer({
      serverUrl: 'https://dahlia.test',
      getKey: () => 'key',
      getMessages: () => undefined,
      replaceHistory: () => {},
      pushToCloud: () => {},
      canSync: () => true,
    })
    expect(await resumer.applyFinished('s1', 'missing', 'Hello.')).toBe(false)
    expect(await resumer.applyFinished('s1', 'u1', 'Hello.')).toBe(false)
  })

  it('skips the cloud push for local-only sessions', async () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', content: 'Hel' },
    ]
    let pushed: unknown = null
    const resumer = createDahliaTurnResumer({
      serverUrl: 'https://dahlia.test',
      getKey: () => 'key',
      getMessages: () => messages,
      replaceHistory: (_sessionId, next) => {
        messages.splice(0, messages.length, ...next)
      },
      pushToCloud: (_sessionId, message) => {
        pushed = message
      },
      canSync: () => false,
    })
    expect(await resumer.applyFinished('s1', 'u1', 'Hello.')).toBe(true)
    expect(pushed).toBeNull()
  })
})
