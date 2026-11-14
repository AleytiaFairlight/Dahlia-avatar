import { describe, expect, it, vi } from 'vitest'

import { setDahliaNsfw } from './dahlia-image-generation'

vi.mock('./server', () => ({ SERVER_URL: 'https://dahlia.example' }))
vi.mock('../stores/dahlia-auth', () => ({ dahliaHeaders: (extra?: Record<string, string>) => ({ Authorization: 'Bearer key', ...extra }), dahliaKey: () => 'key' }))

describe('dahlia image generation', () => {
  it('turns NSFW pictures on or off with the owner\'s key', async () => {
    const requests: { url: string, method?: string, body?: string, authorization?: string }[] = []
    const fetcher: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), method: init?.method, body: String(init?.body), authorization: new Headers(init?.headers).get('Authorization') ?? undefined })
      return new Response(JSON.stringify({ nsfw: false }))
    }

    expect(await setDahliaNsfw(false, 'https://dahlia.example', fetcher)).toBe(false)
    expect(requests).toEqual([
      { url: 'https://dahlia.example/api/v1/dahlia/images/settings', method: 'POST', body: '{"nsfw":false}', authorization: 'Bearer key' },
    ])
  })

  it('says why when the server refuses', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: { message: 'Only Aleytia\'s key can change how Dahlia draws.' } }), { status: 403 })

    await expect(setDahliaNsfw(true, 'https://dahlia.example', fetcher)).rejects.toThrow('Only Aleytia\'s key')
  })
})
