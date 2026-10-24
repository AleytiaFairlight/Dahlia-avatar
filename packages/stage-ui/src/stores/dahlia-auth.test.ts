// @vitest-environment jsdom
// Dahlia: tests for dahlia-auth.ts, the apps' sign-in with the Dahlia key and the voice check.
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearDahliaSession, dahliaBearer, dahliaHeaders, dahliaSession, saveDahliaSession, sendDahliaVoice } from './dahlia-auth'

let key = 'owner-key-12345678'
vi.mock('./providers/config', () => ({
  useProviderConfigStore: () => ({ getProviderConfig: () => ({ apiKey: key }) }),
}))

describe('dahlia auth', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    clearDahliaSession()
    key = 'owner-key-12345678'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the key until there is a session, then the session', () => {
    expect(dahliaBearer()).toBe('owner-key-12345678')

    saveDahliaSession('dvs_session', new Date(Date.now() + 6 * 3600_000).toISOString())
    expect(dahliaBearer()).toBe('dvs_session')
    expect(dahliaHeaders().Authorization).toBe('Bearer dvs_session')
    expect(dahliaHeaders()['X-Dahlia-Device']).toMatch(/^dev-[0-9a-f]{16}$/)
  })

  it('doesn\'t send a session that ran out, or one of another key', () => {
    saveDahliaSession('dvs_old', new Date(Date.now() + 30_000).toISOString())
    expect(dahliaSession()).toBeUndefined()

    saveDahliaSession('dvs_session', new Date(Date.now() + 6 * 3600_000).toISOString())
    key = 'someone-elses-key-99'
    expect(dahliaSession()).toBeUndefined()
    expect(dahliaBearer()).toBe('someone-elses-key-99')
  })

  it('keeps the session that a passed check returns', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/me')
      ? new Response(JSON.stringify({ id: 'owner', name: 'Aleytia', owner: true, voicePrint: true, enrollSamples: 0, enrollNeeded: 3, verified: true }))
      : new Response(JSON.stringify({ session: 'dvs_new', expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(), name: 'Aleytia' })))
    vi.stubGlobal('fetch', fetcher)

    const result = await sendDahliaVoice('verify', { id: 'c1', digits: '123456', text: 'one two three four five six' }, new Blob(['x']))

    expect(result).toEqual({ ok: true, done: true, samples: undefined, needed: undefined })
    expect(dahliaBearer()).toBe('dvs_new')
    expect(fetcher.mock.calls[0][0]).toContain('/api/v1/dahlia/voice-check/verify?challenge=c1')
  })

  it('passes on the server\'s reason when the check fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'voice_mismatch', message: 'That didn\'t sound like your voice print.' } }), { status: 403 })))

    const result = await sendDahliaVoice('verify', { id: 'c1', digits: '123456', text: '' }, new Blob(['x']))

    expect(result).toEqual({ ok: false, code: 'voice_mismatch', message: 'That didn\'t sound like your voice print.' })
    expect(dahliaSession()).toBeUndefined()
  })
})
