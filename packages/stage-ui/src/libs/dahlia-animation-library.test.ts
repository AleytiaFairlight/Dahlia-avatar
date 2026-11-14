import { describe, expect, it, vi } from 'vitest'

import { createDahliaAnimationServer } from './dahlia-animation-library'

const auth = vi.hoisted(() => ({ key: 'key' }))
vi.mock('../stores/dahlia-auth', () => ({ dahliaHeaders: () => ({ Authorization: `Bearer ${auth.key}` }), dahliaKey: () => auth.key }))

describe('dahlia animation library', () => {
  it('lists and downloads the server\'s animations with the app\'s key', async () => {
    const requests: { url: string, authorization?: string }[] = []
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), authorization: (init?.headers as Record<string, string>)?.Authorization })
      return String(url).endsWith('/animations')
        ? new Response(JSON.stringify({ animations: [{ name: 'crab_dance', bytes: 3, sha256: 'a'.repeat(64) }] }))
        : new Response(new Uint8Array([1, 2, 3]))
    }) as unknown as typeof fetch
    const server = createDahliaAnimationServer('https://dahlia.example', fetcher)

    expect(await server.list()).toEqual([{ name: 'crab_dance', bytes: 3, sha256: 'a'.repeat(64) }])
    expect((await server.download('crab_dance')).size).toBe(3)
    expect(requests).toEqual([
      { url: 'https://dahlia.example/api/v1/dahlia/animations', authorization: 'Bearer key' },
      { url: 'https://dahlia.example/api/v1/dahlia/animations/crab_dance.vrma', authorization: 'Bearer key' },
    ])
  })

  it('fails without a key or when the server refuses, so the library asks again later', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch
    const server = createDahliaAnimationServer('https://dahlia.example', fetcher)
    await expect(server.list()).rejects.toThrow('401')

    auth.key = ''
    try {
      await expect(server.list()).rejects.toThrow('key')
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
    finally {
      auth.key = 'key'
    }
  })
})
