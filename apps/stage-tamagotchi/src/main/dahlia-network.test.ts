// Dahlia: tests for dahlia-network.ts, which keeps the desktop app on Dahlia's server.
import { describe, expect, it, vi } from 'vitest'

import { guardFetch, isAllowedUrl } from './dahlia-network'

vi.mock('electron', () => ({ app: { on: vi.fn(), whenReady: vi.fn(async () => {}) }, session: {} }))
vi.mock('@guiiai/logg', () => ({ useLogg: () => ({ useGlobalConfig: () => ({ warn: vi.fn() }) }) }))

describe('dahlia desktop network', () => {
  it.each([
    'https://dahlia.aleytia.moe/api/v1/openai/chat/completions',
    'wss://dahlia.aleytia.moe/ws',
    'https://api.github.com/repos/AleytiaFairlight/Dahlia-avatar/releases?per_page=100',
    'https://github.com/AleytiaFairlight/Dahlia-avatar/releases/download/v0.12.0-beta.5.2/latest-x64.yml',
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/2',
    'http://localhost:6121/ws',
    'ws://127.0.0.1:6121/ws',
    'http://[::1]:5173/',
    'airi-model://assets/model/1/model.json',
    'file:///C:/Users/me/AppData/model.vrm',
    'data:image/png;base64,AAAA',
  ])('allows %s', (url) => {
    expect(isAllowedUrl(url)).toBe(true)
  })

  it.each([
    'https://cdn.jsdelivr.net/fontsource/fonts/dm-sans@latest/latin-400-normal.woff2',
    'https://api.open-meteo.com/v1/forecast?latitude=1&longitude=2',
    'https://api.openai.com/v1/chat/completions',
    'https://analytics.airi.build/capture',
    'https://dahlia.aleytia.moe.example.com/',
    'wss://example.com/ws',
    'http://192.168.10.4:6121/ws',
  ])('blocks %s', (url) => {
    expect(isAllowedUrl(url)).toBe(false)
  })

  it('refuses a blocked fetch without sending it', async () => {
    const send = vi.fn(async () => new Response('ok'))
    const blocked: string[] = []
    const guarded = guardFetch(send as unknown as typeof fetch, url => blocked.push(url))

    await expect(guarded('https://api.open-meteo.com/v1/forecast')).rejects.toThrow(/Dahlia blocked api\.open-meteo\.com/)
    await expect(guarded(new Request('https://api.github.com/repos/AleytiaFairlight/Dahlia-avatar/releases'))).resolves.toBeInstanceOf(Response)

    expect(blocked).toEqual(['https://api.open-meteo.com/v1/forecast'])
    expect(send).toHaveBeenCalledTimes(1)
  })
})
