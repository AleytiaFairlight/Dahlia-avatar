import { describe, expect, it, vi } from 'vitest'

import { DAHLIA_AURA_MAX_SECONDS, DAHLIA_AURA_SECONDS, dahliaAuraForEmotion, onDahliaAura, triggerDahliaAura } from './dahlia-auras'

describe('dahlia auras', () => {
  it('shows an aura only for a strong emotion that has one', () => {
    expect(dahliaAuraForEmotion('angry', 0.7)).toEqual({ kind: 'fire', seconds: DAHLIA_AURA_SECONDS })
    expect(dahliaAuraForEmotion('Surprised', 1)?.kind).toBe('electric')
    expect(dahliaAuraForEmotion('curious', 1)?.kind).toBe('magic')
    expect(dahliaAuraForEmotion('happy', 2)).toEqual({ kind: 'verdant', seconds: DAHLIA_AURA_MAX_SECONDS })
    expect(dahliaAuraForEmotion('happy', 0.5)).toBeUndefined()
    expect(dahliaAuraForEmotion('sad', 1)).toBeUndefined()
    expect(dahliaAuraForEmotion('angry', Number.NaN)).toBeUndefined()
  })

  it('reaches the scenes that listen, until they stop', () => {
    const scene = vi.fn()
    expect(triggerDahliaAura('fire')).toBe(false)
    const stop = onDahliaAura(scene)
    expect(triggerDahliaAura('magic', 5)).toBe(true)
    expect(scene).toHaveBeenCalledWith('magic', 5)
    stop()
    triggerDahliaAura('fire')
    expect(scene).toHaveBeenCalledOnce()
  })
})
