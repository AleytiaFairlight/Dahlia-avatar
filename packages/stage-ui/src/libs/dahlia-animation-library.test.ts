import { describe, expect, it, vi } from 'vitest'

import { createDahliaAnimationServer, DAHLIA_ANIMATION_DOWNLOAD_RETRY_MS, startDahliaAnimationDownloads } from './dahlia-animation-library'

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

  it('downloads the animations a while after the start, and again until the device has them all', async () => {
    vi.useFakeTimers()
    try {
      const answers = [false, false, true]
      const download = vi.fn(async () => answers.shift() ?? true)
      const stop = startDahliaAnimationDownloads({ download, delay: 1000, savesData: () => false })

      await vi.advanceTimersByTimeAsync(999)
      expect(download, 'not while the app starts').not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(download).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(DAHLIA_ANIMATION_DOWNLOAD_RETRY_MS)
      expect(download, 'again: no key yet, or offline').toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(DAHLIA_ANIMATION_DOWNLOAD_RETRY_MS)
      expect(download).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(DAHLIA_ANIMATION_DOWNLOAD_RETRY_MS * 3)
      expect(download, 'it has them all').toHaveBeenCalledTimes(3)
      stop()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('tries again after a download that throws, and stops when asked', async () => {
    vi.useFakeTimers()
    try {
      const download = vi.fn(async (): Promise<boolean> => {
        throw new Error('offline')
      })
      const stop = startDahliaAnimationDownloads({ download, delay: 0, savesData: () => false })
      await vi.advanceTimersByTimeAsync(0)
      expect(download).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(DAHLIA_ANIMATION_DOWNLOAD_RETRY_MS)
      expect(download).toHaveBeenCalledTimes(2)
      stop()
      await vi.advanceTimersByTimeAsync(DAHLIA_ANIMATION_DOWNLOAD_RETRY_MS * 2)
      expect(download).toHaveBeenCalledTimes(2)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('leaves each animation to its first play on a device that saves data', async () => {
    vi.useFakeTimers()
    try {
      const download = vi.fn(async () => true)
      startDahliaAnimationDownloads({ download, delay: 0, savesData: () => true })
      await vi.advanceTimersByTimeAsync(DAHLIA_ANIMATION_DOWNLOAD_RETRY_MS * 2)
      expect(download).not.toHaveBeenCalled()
    }
    finally {
      vi.useRealTimers()
    }
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
