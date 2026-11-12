import { describe, expect, it, vi } from 'vitest'

import { DAHLIA_AURA_PAUSE_MS, startDahliaAvatarAuras } from './dahlia-avatar-auras'

describe('dahlia avatar auras', () => {
  it('shows the aura of an answer\'s emotion, with a pause between two auras', async () => {
    let clock = 0
    let handler: (signal: { type: string, payload?: unknown }) => Promise<void> = async () => {}
    const stop = vi.fn()
    const trigger = vi.fn(() => true)
    const animate = vi.fn()
    const stopped = startDahliaAvatarAuras({
      onSignal: (callback) => {
        handler = callback
        return stop
      },
    }, { now: () => clock, trigger, animate })

    await handler({ type: 'act', payload: { emotion: 'Angry' } })
    expect(trigger).toHaveBeenLastCalledWith('fire', expect.any(Number))
    await handler({ type: 'act', payload: { emotion: { name: 'surprised', intensity: 1 } } })
    expect(trigger, 'too soon after the fire').toHaveBeenCalledOnce()

    clock += DAHLIA_AURA_PAUSE_MS
    await handler({ type: 'act', payload: { emotion: { name: 'curious', intensity: 0.3 } } })
    await handler({ type: 'act', payload: { emotion: 'sad' } })
    await handler({ type: 'delay' })
    await handler({ type: 'act', payload: { motion: 'nod' } })
    expect(trigger, 'weak emotions, emotions without an aura and other signals show none').toHaveBeenCalledOnce()
    await handler({ type: 'act', payload: { emotion: 'surprised' } })
    expect(trigger).toHaveBeenLastCalledWith('electric', expect.any(Number))

    expect(animate, 'an ACT motion is offered to her animation library').toHaveBeenCalledExactlyOnceWith({ op: 'play', name: 'nod' })

    stopped()
    expect(stop).toHaveBeenCalledOnce()
  })
})
