// Dahlia: tests for dahlia-window-helper.ts, the main process's side of the game window helper.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import type { DahliaOwnWindow, DahliaWindowAnswer, DahliaWindowHelper, DahliaWindowRequest } from './dahlia-window-helper'

import { createDahliaWindowHelper, withDahliaOutOfTheWay } from './dahlia-window-helper'

vi.mock('electron', () => ({ app: { on: vi.fn() }, ipcMain: { handle: vi.fn() }, BrowserWindow: { getAllWindows: vi.fn(() => []) }, screen: {} }))
vi.mock('../../resources/dahlia-window-helper.ps1?asset&asarUnpack', () => ({ default: '/app/dahlia-window-helper.ps1' }))

/** A helper process that answers each request with handle(request). */
function fakeHelper(handle: (request: Record<string, unknown>) => Record<string, unknown> | undefined) {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams & EventEmitter
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  Object.assign(child, { stdin, stdout, stderr: new PassThrough(), kill: vi.fn(() => child.emit('exit', 0)) })
  let buffer = ''
  stdin.on('data', (chunk) => {
    buffer += String(chunk)
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const request = JSON.parse(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
      const answer = handle(request)
      if (answer)
        stdout.write(`${JSON.stringify({ id: request.id, ...answer })}\n`)
    }
  })
  return child
}

describe('dahlia window helper', () => {
  it('sends requests to the helper and matches its answers', async () => {
    const start = vi.fn(() => fakeHelper(request => request.op === 'find' ? { ok: true, hwnd: 42, title: 'Dark War: Survival' } : { ok: true }))
    const helper = createDahliaWindowHelper(start)

    const [found, tapped] = await Promise.all([helper.call({ op: 'find', title: 'Dark War' }), helper.call({ op: 'tap', hwnd: 42, x: 500, y: 900 })])

    expect(found).toMatchObject({ ok: true, hwnd: 42 })
    expect(tapped).toMatchObject({ ok: true })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('refuses unknown requests, and answers waiting ones when the helper stops', async () => {
    let child!: ReturnType<typeof fakeHelper>
    const helper = createDahliaWindowHelper(() => (child = fakeHelper(() => undefined)))

    expect(await helper.call({ op: 'delete-everything' } as never)).toEqual({ ok: false, error: 'Unknown request.' })
    const waiting = helper.call({ op: 'capture', hwnd: 1, maxHeight: 1024 })
    child.emit('exit', 1)
    expect(await waiting).toEqual({ ok: false, error: 'The window helper stopped.' })
  })
})

/** The game window of these tests is at 0,0, 1280x720. */
const GAME_FRAME = { ok: true, left: 0, top: 0, width: 1280, height: 720 } as const

/** A helper that records what it was asked, and the state of Dahlia's windows at the time. */
function recordingHelper(log: string[], windows: Record<string, ReturnType<typeof ownWindow>>): DahliaWindowHelper {
  return {
    call: vi.fn(async (request: DahliaWindowRequest): Promise<DahliaWindowAnswer> => {
      if (request.op === 'frame')
        return GAME_FRAME
      const state = Object.entries(windows).map(([name, window]) => `${name}:${window.hidden ? 'hidden' : 'shown'}/${window.protectedNow ? 'protected' : 'captured'}`)
      log.push(`${request.op} ${state.join(' ')}`)
      return { ok: true }
    }),
    dispose: vi.fn(),
  }
}

/** One of Dahlia's windows at the given bounds. */
function ownWindow(bounds: { x: number, y: number, width: number, height: number }, alwaysProtected = false) {
  const window = {
    hidden: false,
    protectedNow: alwaysProtected,
    isDestroyed: () => false,
    isVisible: () => !window.hidden,
    isMinimized: () => false,
    isContentProtected: () => window.protectedNow,
    getBounds: () => bounds,
    setContentProtection: vi.fn((enable: boolean) => { window.protectedNow = enable }),
    hide: vi.fn(() => { window.hidden = true }),
    showInactive: vi.fn(() => { window.hidden = false }),
  }
  return window satisfies DahliaOwnWindow
}

describe('dahlia window helper guard', () => {
  function guard(windows: Record<string, ReturnType<typeof ownWindow>>) {
    const log: string[] = []
    const helper = withDahliaOutOfTheWay(recordingHelper(log, windows), {
      ownWindows: () => Object.values(windows),
      toDip: rect => rect,
      wait: async () => {},
    })
    return { helper, log }
  }

  it('leaves her overlapping windows out of a capture of the game, and puts them back', async () => {
    // ROOT CAUSE:
    //
    // Her avatar and chat stay on top, and a window capture copies the screen, so where they overlapped the game
    // she saw herself (the Start button was behind her chat panel) instead of the game.
    const windows = { avatar: ownWindow({ x: 600, y: 300, width: 400, height: 700 }), aside: ownWindow({ x: 2000, y: 0, width: 300, height: 300 }) }
    const { helper, log } = guard(windows)

    await helper.call({ op: 'capture', hwnd: 7, maxHeight: 1080 })

    expect(log).toEqual(['capture avatar:shown/protected aside:shown/captured'])
    expect(windows.avatar.protectedNow).toBe(false)
    expect(windows.avatar.hide).not.toHaveBeenCalled()
    expect(windows.aside.setContentProtection).not.toHaveBeenCalled()
  })

  it('keeps a window that is always left out of captures that way', async () => {
    const windows = { overlay: ownWindow({ x: 0, y: 0, width: 1920, height: 1080 }, true) }
    const { helper } = guard(windows)

    await helper.call({ op: 'capture', hwnd: 7, maxHeight: 1080 })

    expect(windows.overlay.setContentProtection).not.toHaveBeenCalled()
    expect(windows.overlay.protectedNow).toBe(true)
  })

  it('hides her overlapping windows while she taps or swipes the game, and shows them again without focus', async () => {
    // ROOT CAUSE:
    //
    // A tap is a real click at a point on the screen. Where her own window covered the game, the click landed on
    // her window: the tap reported success and the game's Start button never got it.
    const windows = { avatar: ownWindow({ x: 600, y: 300, width: 400, height: 700 }), aside: ownWindow({ x: 2000, y: 0, width: 300, height: 300 }) }
    const { helper, log } = guard(windows)

    await helper.call({ op: 'tap', hwnd: 7, x: 600, y: 900 })
    await helper.call({ op: 'swipe', hwnd: 7, x1: 500, y1: 500, x2: 500, y2: 200, ms: 400 })

    expect(log).toEqual([
      'tap avatar:hidden/captured aside:shown/captured',
      'swipe avatar:hidden/captured aside:shown/captured',
    ])
    expect(windows.avatar.showInactive).toHaveBeenCalledTimes(2)
    expect(windows.avatar.hidden).toBe(false)
    expect(windows.aside.hide).not.toHaveBeenCalled()
  })

  it('passes other requests straight through, and keeps her windows when the window is not in the way', async () => {
    const windows = { aside: ownWindow({ x: 2000, y: 0, width: 300, height: 300 }) }
    const { helper, log } = guard(windows)

    await helper.call({ op: 'find', title: 'Dark War' })
    await helper.call({ op: 'tap', hwnd: 7, x: 500, y: 500 })

    expect(log).toEqual(['find aside:shown/captured', 'tap aside:shown/captured'])
    expect(windows.aside.hide).not.toHaveBeenCalled()
  })
})
