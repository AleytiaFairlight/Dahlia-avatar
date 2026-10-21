// Dahlia: tests for dahlia-updater.ts, the Android app's update check against GitHub releases.
import { describe, expect, it, vi } from 'vitest'

import { compareVersions, DAHLIA_RELEASES_URL, findAndroidUpdate, newestAndroidRelease } from './dahlia-updater'

function release(tag: string, assets = [`Dahlia-${tag.slice(1)}-android.apk`, `Dahlia-${tag.slice(1)}-windows-x64-setup.exe`], draft = false) {
  return {
    tag_name: tag,
    draft,
    assets: assets.map(name => ({ name, browser_download_url: `https://github.com/AleytiaFairlight/Dahlia-avatar/releases/download/${tag}/${name}` })),
  }
}

function respond(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }) as Response)
}

describe('dahlia android updater', () => {
  it.each([
    ['0.12.0-beta.5.3', '0.12.0-beta.5.2', 1],
    ['0.12.0-beta.5.10', '0.12.0-beta.5.9', 1],
    ['0.12.0-beta.6', '0.12.0-beta.5.3', 1],
    ['0.12.0', '0.12.0-beta.5.3', 1],
    ['0.13.0-beta.1', '0.12.0', 1],
    ['v0.12.0-beta.5.3', '0.12.0-beta.5.3', 0],
    ['0.12.0-beta.5', '0.12.0-beta.5.1', -1],
  ])('compares %s with %s', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected)
    // Adding 0 turns -0 into 0, which toBe tells apart.
    expect(Math.sign(compareVersions(b, a)) + 0).toBe(-expected + 0)
  })

  it('picks the newest release with an Android app, not the newest listed', () => {
    const newest = newestAndroidRelease([
      release('v0.12.0-beta.5.4', ['Dahlia-0.12.0-beta.5.4-windows-x64-setup.exe']),
      release('v0.12.0-beta.5.2'),
      release('v0.12.0-beta.5.3'),
      release('v0.12.0-beta.5.5', undefined, true),
    ])

    expect(newest).toEqual({
      version: '0.12.0-beta.5.3',
      apkUrl: 'https://github.com/AleytiaFairlight/Dahlia-avatar/releases/download/v0.12.0-beta.5.3/Dahlia-0.12.0-beta.5.3-android.apk',
    })
  })

  it('offers only a newer version', async () => {
    const fetcher = respond([release('v0.12.0-beta.5.3')])

    expect((await findAndroidUpdate('0.12.0-beta.5.2', fetcher))?.version).toBe('0.12.0-beta.5.3')
    expect(await findAndroidUpdate('0.12.0-beta.5.3', fetcher)).toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith(DAHLIA_RELEASES_URL, expect.anything())
  })

  it('offers nothing when GitHub refuses or answers something else', async () => {
    expect(await findAndroidUpdate('0.12.0-beta.5.2', respond({ message: 'rate limited' }, false))).toBeUndefined()
    expect(await findAndroidUpdate('0.12.0-beta.5.2', respond({ message: 'Not Found' }))).toBeUndefined()
  })
})
