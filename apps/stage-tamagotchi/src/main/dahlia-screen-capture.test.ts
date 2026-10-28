// Dahlia: tests for dahlia-screen-capture.ts, screenshots and recordings for Dahlia.
import type { DesktopCapturerSource } from 'electron'

import type { DahliaScreenDeps } from './dahlia-screen-capture'
import type { DahliaWindowRequest } from './dahlia-window-helper'

import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { findSource, pickWindowSource, recordingFileName, takeScreenshot, titleRank } from './dahlia-screen-capture'

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, desktopCapturer: {}, ipcMain: { handle: vi.fn() }, screen: {} }))
vi.mock('./dahlia-window-helper', () => ({ callDahliaWindowHelper: vi.fn() }))

function source(id: string, name: string, display_id = '', empty = false): DesktopCapturerSource {
  return {
    id,
    name,
    display_id,
    appIcon: null as never,
    thumbnail: {
      isEmpty: () => empty,
      getSize: () => ({ width: 960, height: 540 }),
      toJPEG: () => Buffer.from('jpeg'),
    } as never,
  }
}

function deps(sources: DesktopCapturerSource[], overrides: Partial<DahliaScreenDeps> = {}): DahliaScreenDeps {
  return {
    getSources: vi.fn(async options => sources.filter(s => s.id.startsWith(options.types[0] === 'screen' ? 'screen:' : 'window:'))),
    helper: vi.fn(async () => ({ ok: false as const, error: 'No helper.' })),
    ownSourceIds: () => ['window:1:0'],
    primaryDisplayId: () => '20',
    displayIds: () => ['10', '20'],
    now: () => 0,
    ...overrides,
  }
}

describe('dahlia screen capture', () => {
  it('ranks titles: the same, then starting with it, then containing it', () => {
    expect(titleRank('Dark War', 'dark war')).toBe(2)
    expect(titleRank('Dark War: Survival', 'Dark War')).toBe(1)
    expect(titleRank('Guide to Dark War - Chrome', 'Dark War')).toBe(0)
    expect(titleRank('Notepad', 'Dark War')).toBe(-1)
  })

  it('picks the best window, never one of Dahlia\'s own', () => {
    const sources = [source('window:1:0', 'Dark War'), source('window:2:0', 'Guide to Dark War - Chrome'), source('window:3:0', 'Dark War: Survival')]
    expect(pickWindowSource(sources, 'Dark War', ['window:1:0'])?.id).toBe('window:3:0')
  })

  it('takes the window the helper found, by its handle', async () => {
    const helper = vi.fn(async () => ({ ok: true as const, hwnd: 2, title: 'Dark War: Survival' }))
    const found = await findSource({ window: 'Dark War' }, { width: 0, height: 0 }, deps([source('window:3:0', 'Dark War'), source('window:2:0', 'Dark War: Survival')], { helper }))
    expect(found).toMatchObject({ ok: true, source: { id: 'window:2:0' } })
    expect(helper).toHaveBeenCalledWith({ op: 'find', title: 'Dark War', anyApp: true })
  })

  it('takes the main screen by default and another by its number', async () => {
    const screens = [source('screen:0:0', 'Screen 1', '10'), source('screen:1:0', 'Screen 2', '20')]
    expect(await findSource({}, { width: 0, height: 0 }, deps(screens))).toMatchObject({ source: { id: 'screen:1:0' } })
    expect(await findSource({ screen: 1 }, { width: 0, height: 0 }, deps(screens))).toMatchObject({ source: { id: 'screen:0:0' } })
    expect(await findSource({ screen: 3 }, { width: 0, height: 0 }, deps(screens))).toEqual({ ok: false, error: 'This PC has 2 screens.' })
  })

  it('returns a JPEG of a screen through the desktop capturer', async () => {
    expect(await takeScreenshot({ op: 'screenshot' }, deps([source('screen:1:0', 'Screen 1', '20')]))).toEqual({
      ok: true,
      image: `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`,
      width: 960,
      height: 540,
      name: 'Screen 1',
    })
  })

  it('captures a window through the helper, so a GPU game is not black', async () => {
    const helper = vi.fn(async (request: DahliaWindowRequest) =>
      request.op === 'find'
        ? { ok: true as const, hwnd: 7, title: 'Dark War: Survival' }
        : { ok: true as const, png: 'UE5H', width: 540, height: 960 })
    const answer = await takeScreenshot({ op: 'screenshot', window: 'Dark War' }, deps([], { helper }))
    expect(answer).toEqual({ ok: true, image: 'data:image/png;base64,UE5H', width: 540, height: 960, name: 'Dark War: Survival' })
    expect(helper).toHaveBeenCalledWith({ op: 'find', title: 'Dark War', anyApp: true })
    expect(helper).toHaveBeenCalledWith({ op: 'capture', hwnd: 7, maxHeight: 1080 })
  })

  it('says a window picture is empty, and passes on the helper\'s reason when the window is gone', async () => {
    const empty = vi.fn(async (request: DahliaWindowRequest) =>
      request.op === 'find' ? { ok: true as const, hwnd: 7, title: 'Game' } : { ok: true as const, png: '', width: 0, height: 0 })
    expect(await takeScreenshot({ op: 'screenshot', window: 'Game' }, deps([], { helper: empty }))).toEqual({ ok: false, error: 'Windows gave an empty picture of "Game". Is it minimized?' })
    const missing = vi.fn(async () => ({ ok: false as const, error: 'No open window has "Nothing" in its title.' }))
    expect(await takeScreenshot({ op: 'screenshot', window: 'Nothing' }, deps([], { helper: missing }))).toEqual({ ok: false, error: 'No open window has "Nothing" in its title.' })
  })

  it('names recordings after the window, without characters Windows forbids', () => {
    expect(recordingFileName('Dark War: Survival', 'mp4', new Date('2026-10-27T09:30:05Z'))).toBe('Dahlia - Dark War Survival - 2026-10-27 09-30-05.mp4')
    expect(recordingFileName('', 'webm', new Date('2026-10-27T09:30:05Z'))).toBe('Dahlia - Screen - 2026-10-27 09-30-05.webm')
  })
})
