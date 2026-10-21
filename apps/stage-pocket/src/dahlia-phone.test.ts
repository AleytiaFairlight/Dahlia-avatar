// Dahlia: tests for dahlia-phone.ts, the Android side of her phone features.
import { describe, expect, it, vi } from 'vitest'

import { takeDahliaWake } from './dahlia-phone'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => ({}),
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }))
vi.mock('@proj-airi/stage-ui/stores/dahlia-external-wake', () => ({ requestDahliaWake: vi.fn() }))

describe('dahlia phone', () => {
  it('starts an input when Android opened the app to listen', async () => {
    const wake = vi.fn()

    await takeDahliaWake({ consumeWake: async () => ({ wake: true }) }, wake)
    await takeDahliaWake({ consumeWake: async () => ({ wake: false }) }, wake)

    expect(wake).toHaveBeenCalledTimes(1)
  })

  it('ignores a plugin that isn\'t there', async () => {
    const wake = vi.fn()

    const missing = async () => {
      throw new Error('"Dahlia" plugin is not implemented on web')
    }
    await takeDahliaWake({ consumeWake: missing }, wake)

    expect(wake).not.toHaveBeenCalled()
  })
})
