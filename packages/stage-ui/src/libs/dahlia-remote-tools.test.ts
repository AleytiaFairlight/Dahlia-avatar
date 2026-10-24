// Dahlia: tests for dahlia-remote-tools.ts, a device's tools for Dahlia on the user's other devices.
import type { DahliaRemoteTool, DahliaRemoteToolsOptions } from './dahlia-remote-tools'

import { describe, expect, it, vi } from 'vitest'

import { DAHLIA_REMOTE_APPROVAL_MS, dahliaRemoteToolName, DahliaRemoteTools } from './dahlia-remote-tools'

function tool(name: string, readOnly: boolean, run = vi.fn(async (args: Record<string, unknown>) => `${name} ran with ${JSON.stringify(args)}`)): DahliaRemoteTool {
  return { name, description: `Does ${name}.`, inputSchema: { type: 'object' }, readOnly, run }
}

function setup(overrides: Partial<DahliaRemoteToolsOptions> = {}, calls: unknown[] = []) {
  let now = 0
  const results: unknown[] = []
  const polls: Record<string, unknown>[] = []
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    if (url.endsWith('/poll')) {
      polls.push(body)
      return { ok: true, status: 200, json: async () => ({ calls: calls.splice(0) }) } as Response
    }
    results.push(...body.results)
    return { ok: true, status: 200, json: async () => ({ accepted: 1 }) } as Response
  })
  const states: string[] = []
  const remote = new DahliaRemoteTools({
    serverUrl: 'https://dahlia.test',
    getKey: () => 'key',
    deviceId: 'pc-1',
    deviceName: () => 'Desk PC',
    platform: 'Windows',
    enabled: () => true,
    listTools: async () => [tool('dahlia-files_find_files', true), tool('computer_use', false)],
    confirm: vi.fn(async () => true),
    onState: state => states.push(state),
    fetcher: fetcher as unknown as typeof fetch,
    now: () => now,
    ...overrides,
  })
  const advance = (ms: number) => {
    now += ms
  }
  return { remote, results, polls, states, fetcher, advance }
}

/** Lets the calls that a poll started finish. */
async function settle() {
  for (let i = 0; i < 5; i++)
    await new Promise(resolve => setTimeout(resolve, 0))
}

describe('dahlia remote tools', () => {
  it('offers the device\'s tools and runs a read-only call at once', async () => {
    const confirm = vi.fn(async () => true)
    const { remote, results, polls, states } = setup({ confirm }, [{ id: 'c1', tool: 'dahlia-files_find_files', arguments: { query: 'invoice' } }])

    expect(await remote.cycle()).toBe(0)
    await settle()

    expect(polls[0]).toMatchObject({ deviceId: 'pc-1', name: 'Desk PC', platform: 'Windows' })
    expect((polls[0].tools as { name: string, readOnly: boolean }[]).map(t => [t.name, t.readOnly])).toEqual([['dahlia-files_find_files', true], ['computer_use', false]])
    expect(results).toEqual([{ id: 'c1', text: 'dahlia-files_find_files ran with {"query":"invoice"}', isError: false }])
    expect(confirm).not.toHaveBeenCalled()
    expect(states).toEqual(['connected'])
  })

  it('asks before a call that changes something, then not again for ten minutes', async () => {
    const confirm = vi.fn(async () => true)
    const calls: unknown[] = []
    const { remote, results, advance } = setup({ confirm }, calls)

    calls.push({ id: 'c1', tool: 'computer_use', arguments: { argv: ['invoke', 'app', 'open'] } })
    await remote.cycle()
    await settle()
    calls.push({ id: 'c2', tool: 'computer_use', arguments: {} })
    await remote.cycle()
    await settle()
    expect(confirm).toHaveBeenCalledTimes(1)

    advance(DAHLIA_REMOTE_APPROVAL_MS)
    calls.push({ id: 'c3', tool: 'computer_use', arguments: {} })
    await remote.cycle()
    await settle()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(3)
  })

  it('reports a refusal, a failure and an unknown tool as errors', async () => {
    const failing = tool('broken', true, vi.fn(async () => {
      throw new Error('disk not found')
    }))
    const { remote, results } = setup({
      confirm: vi.fn(async () => false),
      listTools: async () => [tool('computer_use', false), failing],
    }, [
      { id: 'c1', tool: 'computer_use', arguments: {} },
      { id: 'c2', tool: 'broken', arguments: {} },
      { id: 'c3', tool: 'gone', arguments: {} },
    ])

    await remote.cycle()
    await settle()

    expect(results).toEqual(expect.arrayContaining([
      { id: 'c1', text: 'The user didn\'t allow this on the device.', isError: true },
      { id: 'c2', text: 'disk not found', isError: true },
      { id: 'c3', text: 'This device has no tool named gone any more.', isError: true },
    ]))
  })

  it('waits without a key, when turned off, and after a refused key', async () => {
    expect(await setup({ getKey: () => undefined }).remote.cycle()).toBe(30_000)
    expect(await setup({ enabled: () => false }).remote.cycle()).toBe(15_000)

    const refused = setup({ fetcher: vi.fn(async () => ({ ok: false, status: 401 }) as Response) as unknown as typeof fetch })
    expect(await refused.remote.cycle()).toBe(60_000)
    expect(refused.states).toEqual(['bad-key'])
  })

  it('backs off while the server is unreachable', async () => {
    const unreachable = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { remote, states } = setup({ fetcher: unreachable as unknown as typeof fetch })

    expect(await remote.cycle()).toBe(4_000)
    expect(await remote.cycle()).toBe(8_000)
    expect(states).toEqual(['error', 'error'])
  })

  it('makes names the server accepts', () => {
    expect(dahliaRemoteToolName('dahlia-files_find files::x')).toBe('dahlia-files_find_files__x')
  })

  it('polls with the tools it had when listing them hangs', async () => {
    vi.useFakeTimers()
    try {
      const { remote, polls } = setup({ listTools: () => new Promise<DahliaRemoteTool[]>(() => {}) })
      const cycle = remote.cycle()
      await vi.advanceTimersByTimeAsync(15_000)
      expect(await cycle).toBe(0)
      expect(polls).toHaveLength(1)
      expect(polls[0].tools).toEqual([])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('waits for a voice check when the server asks for one', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response)
    const { remote, states } = setup({ fetcher: fetcher as unknown as typeof fetch })

    expect(await remote.cycle()).toBe(30_000)
    expect(states.at(-1)).toBe('voice-check')
  })

  it('runs a call that changes something without asking when the user chose so', async () => {
    const confirm = vi.fn(async () => false)
    const { remote, results } = setup({ confirm, runWithoutAsking: () => true }, [{ id: 'c1', tool: 'computer_use', arguments: {} }])

    await remote.cycle()
    await settle()

    expect(confirm).not.toHaveBeenCalled()
    expect(results).toEqual([{ id: 'c1', text: 'computer_use ran with {}', isError: false }])
  })
})
