// Dahlia: tests for dahlia-external-wake.ts, wakes from outside the web app.
import { describe, expect, it, vi } from 'vitest'

import { DAHLIA_EXTERNAL_WAKE_MS, hasPendingDahliaWake, requestDahliaWake, withDahliaExternalWake } from './dahlia-external-wake'

vi.mock('./modules/airi-card', () => ({ useAiriCardStore: () => ({ activeCardId: 'default' }) }))

const window = {} as Parameters<ReturnType<typeof withDahliaExternalWake>>[0]
const activity = { speech: false, durationMs: 32 }

describe('dahlia external wake', () => {
  it('answers the next audio window with the active character, once', async () => {
    const detect = vi.fn(async () => undefined)
    const resolveTarget = vi.fn(async (characterId: string) => ({ sessionId: `session-of-${characterId}`, interruptTurns: [] }))
    const wrapped = withDahliaExternalWake(detect, resolveTarget)

    expect(await wrapped(window, new AbortController().signal, activity)).toBeUndefined()
    expect(detect).toHaveBeenCalledTimes(1)

    requestDahliaWake()
    expect(await wrapped(window, new AbortController().signal, activity)).toEqual({ sessionId: 'session-of-default', interruptTurns: [] })
    expect(detect).toHaveBeenCalledTimes(1)

    expect(await wrapped(window, new AbortController().signal, activity)).toBeUndefined()
    expect(detect).toHaveBeenCalledTimes(2)
  })

  it('expires when the microphone never comes', () => {
    requestDahliaWake(1_000)

    expect(hasPendingDahliaWake(1_000 + DAHLIA_EXTERNAL_WAKE_MS - 1)).toBe(true)
    expect(hasPendingDahliaWake(1_000 + DAHLIA_EXTERNAL_WAKE_MS)).toBe(false)
  })

  it('works without wake words on the card', async () => {
    const wrapped = withDahliaExternalWake(undefined, async () => ({ sessionId: 's', interruptTurns: [] }))

    expect(await wrapped(window, new AbortController().signal, activity)).toBeUndefined()
    requestDahliaWake()
    expect(await wrapped(window, new AbortController().signal, activity)).toEqual({ sessionId: 's', interruptTurns: [] })
  })
})
