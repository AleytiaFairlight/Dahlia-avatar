import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCloudFetch } from './cloud'

describe('cloud request boundary', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CLOUD_URL', 'https://cloud.example.test')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses the configured Cloud origin and caller cancellation, without credentials', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ flags: [] }))
    const controller = new AbortController()
    await useCloudFetch()('/v1/feature-flags', { signal: controller.signal })
    expect(network).toHaveBeenCalledTimes(1)
    const [url, init] = network.mock.calls[0]!
    expect(String(url)).toBe('https://cloud.example.test/v1/feature-flags')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(init?.credentials).toBe('omit')
    expect(init?.signal).toBe(controller.signal)
  })

  it('rejects off-origin URLs before sending a request', () => {
    const network = vi.spyOn(globalThis, 'fetch')
    const cloudFetch = useCloudFetch()
    expect(() => cloudFetch('https://other.example.test/flags')).toThrow('Cloud origin')
    expect(() => cloudFetch('//other.example.test/flags')).toThrow('Cloud origin')
    expect(network).not.toHaveBeenCalled()
  })
})
