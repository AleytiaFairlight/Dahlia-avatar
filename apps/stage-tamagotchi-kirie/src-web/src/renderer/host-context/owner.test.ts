import { describe, expect, it, vi } from 'vitest'

import type { InvokeEventa } from '@moeru/eventa'

import { useHostEventaInvoke } from './owner'

const defineInvoke = vi.hoisted(() => vi.fn())

vi.mock('@moeru/eventa', async (importOriginal) => {
  const original = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...original,
    defineInvoke: (...args: unknown[]) => defineInvoke(...args),
  }
})

// createKirieContext needs a real IPC transport; these tests always pass an
// explicit context so it is never constructed.
vi.mock('@gd-kirie/ipc-eventa', () => ({
  createKirieContext: () => {
    throw new Error('must not construct a real host context in unit tests')
  },
}))

vi.mock('@gd-kirie/ipc', () => ({}))

describe('useHostEventaInvoke', () => {
  it('sends an explicit empty payload when invoked without one', async () => {
    const inner = vi.fn().mockResolvedValue('ok')
    defineInvoke.mockReturnValue(inner)

    const invoke = useHostEventaInvoke({} as unknown as InvokeEventa<string>, {} as never)
    await (invoke as () => Promise<string>)()

    // JSON drops `undefined`, and the Godot host drops invokes whose send
    // body has no `content` — so no-arg invokes must send `{}` explicitly.
    expect(inner).toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledWith({})
  })

  it('passes explicit payloads and options through untouched', async () => {
    const inner = vi.fn().mockResolvedValue('ok')
    defineInvoke.mockReturnValue(inner)

    const invoke = useHostEventaInvoke({} as unknown as InvokeEventa<string, { a: number }>, {} as never)
    await (invoke as (payload: { a: number }, options?: { timeout: number }) => Promise<string>)({ a: 1 }, { timeout: 5 })

    expect(inner).toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledWith({ a: 1 }, { timeout: 5 })
  })
})
