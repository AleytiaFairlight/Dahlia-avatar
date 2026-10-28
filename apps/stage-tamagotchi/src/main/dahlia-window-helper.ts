// Dahlia: runs resources/dahlia-window-helper.ps1, which finds, captures and taps a game window on Windows,
// and answers the renderer's requests to it on the "dahlia:window" channel, for her game player
// (src/renderer/dahlia-game-player.ts); her screenshots, recordings and game launches find windows with it too
// (dahlia-screen-capture.ts, dahlia-game-launcher.ts). This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls setupDahliaWindowHelper() when the main process starts.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { Rectangle } from 'electron'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import { app, BrowserWindow, ipcMain, screen } from 'electron'

import helperScript from '../../resources/dahlia-window-helper.ps1?asset&asarUnpack'

export const DAHLIA_WINDOW_CHANNEL = 'dahlia:window'

export type DahliaWindowRequest
  = | { op: 'find', title: string, anyApp?: boolean }
    | { op: 'capture', hwnd: number, maxHeight: number }
    | { op: 'tap', hwnd: number, x: number, y: number }
    | { op: 'swipe', hwnd: number, x1: number, y1: number, x2: number, y2: number, ms: number }
    | { op: 'key', hwnd: number, key: 'escape' | 'enter' | 'space' }
    | { op: 'show', hwnd: number }
    | { op: 'foreground' }
    | { op: 'frame', hwnd: number }

export type DahliaWindowAnswer = { ok: true, [field: string]: unknown } | { ok: false, error: string }

const OPS = new Set(['find', 'capture', 'tap', 'swipe', 'key', 'show', 'foreground', 'frame'])
/** A capture of a large window can take a few seconds; anything longer means the helper is stuck. */
const REQUEST_TIMEOUT_MS = 20_000

export interface DahliaWindowHelper {
  call: (request: DahliaWindowRequest) => Promise<DahliaWindowAnswer>
  dispose: () => void
}

/** Starts the helper on the first request, and again after it exits. */
export function createDahliaWindowHelper(start: () => ChildProcessWithoutNullStreams): DahliaWindowHelper {
  let child: ChildProcessWithoutNullStreams | undefined
  let nextId = 1
  const pending = new Map<number, { resolve: (answer: DahliaWindowAnswer) => void, timer: ReturnType<typeof setTimeout> }>()

  function settle(id: number, answer: DahliaWindowAnswer) {
    const waiting = pending.get(id)
    if (!waiting)
      return
    clearTimeout(waiting.timer)
    pending.delete(id)
    waiting.resolve(answer)
  }

  function ensure() {
    if (child)
      return child
    const started = start()
    child = started
    createInterface({ input: started.stdout }).on('line', (line) => {
      let answer: { id?: number } & DahliaWindowAnswer
      try {
        answer = JSON.parse(line)
      }
      catch {
        return
      }
      if (typeof answer.id === 'number')
        settle(answer.id, answer)
    })
    started.stderr.on('data', data => console.warn('Dahlia window helper:', String(data).trim()))
    started.on('exit', () => {
      if (child === started)
        child = undefined
      for (const id of [...pending.keys()])
        settle(id, { ok: false, error: 'The window helper stopped.' })
    })
    started.on('error', (error) => {
      if (child === started)
        child = undefined
      for (const id of [...pending.keys()])
        settle(id, { ok: false, error: `The window helper couldn't start: ${error.message}` })
    })
    return started
  }

  return {
    call(request) {
      if (!request || !OPS.has(request.op))
        return Promise.resolve({ ok: false, error: 'Unknown request.' })
      const id = nextId++
      return new Promise((resolve) => {
        const timer = setTimeout(settle, REQUEST_TIMEOUT_MS, id, { ok: false, error: 'The window helper didn\'t answer.' })
        pending.set(id, { resolve, timer })
        ensure().stdin.write(`${JSON.stringify({ ...request, id })}\n`)
      })
    },
    dispose() {
      child?.kill()
      child = undefined
    },
  }
}

/** One of Dahlia's own windows, as the guard uses it (an Electron BrowserWindow). */
export interface DahliaOwnWindow {
  isDestroyed: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
  isContentProtected: () => boolean
  getBounds: () => Rectangle
  setContentProtection: (enable: boolean) => void
  hide: () => void
  showInactive: () => void
}

export interface DahliaWindowGuardDeps {
  /** Her open windows: the stage with her avatar, the chat, captions, ... */
  ownWindows: () => DahliaOwnWindow[]
  /** A rectangle in physical screen pixels, as the helper measures windows, in Electron's DIPs. */
  toDip: (rect: Rectangle) => Rectangle
  wait: (ms: number) => Promise<void>
}

/** DWM applies a hidden window, or a window left out of captures, on its next frames. */
const SETTLE_MS = 80

function intersects(a: Rectangle, b: Rectangle) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * Keeps Dahlia's own windows out of what she sees and clicks in another window. Her avatar, chat and toasts stay on
 * top of everything, and her window captures copy the screen, so where they overlapped the game she saw herself
 * instead of the game (its Start button sat behind her chat), and a tap there landed on her own window: the click
 * "succeeded" and the game never got it. For a capture, her overlapping windows are left out of screen captures
 * (content protection) for that moment, which changes nothing on the screen; for a tap or a swipe they are hidden
 * for that moment and shown again without taking the focus, which also keeps each one's own click-through state.
 * Windows that don't overlap the target are left alone, and guarded calls run one at a time, so one call's restore
 * never lands in the middle of another's capture.
 */
export function withDahliaOutOfTheWay(helper: DahliaWindowHelper, deps: DahliaWindowGuardDeps): DahliaWindowHelper {
  let queue: Promise<unknown> = Promise.resolve()

  async function inTheWay(hwnd: number) {
    const frame = await helper.call({ op: 'frame', hwnd })
    if (!frame.ok)
      return []
    const target = deps.toDip({ x: Number(frame.left), y: Number(frame.top), width: Number(frame.width), height: Number(frame.height) })
    return deps.ownWindows().filter(window => !window.isDestroyed() && window.isVisible() && !window.isMinimized() && intersects(window.getBounds(), target))
  }

  async function guarded(request: Extract<DahliaWindowRequest, { op: 'capture' | 'tap' | 'swipe' }>) {
    const windows = await inTheWay(request.hwnd)
    if (windows.length === 0)
      return helper.call(request)

    if (request.op === 'capture') {
      // A window that is always left out of captures (the desktop overlay) stays that way.
      const excluded = windows.filter(window => !window.isContentProtected())
      excluded.forEach(window => window.setContentProtection(true))
      try {
        await deps.wait(SETTLE_MS)
        return await helper.call(request)
      }
      finally {
        excluded.filter(window => !window.isDestroyed()).forEach(window => window.setContentProtection(false))
      }
    }

    windows.forEach(window => window.hide())
    try {
      await deps.wait(SETTLE_MS)
      return await helper.call(request)
    }
    finally {
      windows.filter(window => !window.isDestroyed()).forEach(window => window.showInactive())
    }
  }

  return {
    call(request) {
      if (request?.op !== 'capture' && request?.op !== 'tap' && request?.op !== 'swipe')
        return helper.call(request)
      const result = queue.then(() => guarded(request))
      queue = result.catch(() => undefined)
      return result
    },
    dispose: () => helper.dispose(),
  }
}

let shared: DahliaWindowHelper | undefined

/** A request to the main process's helper, for the other Dahlia modules there. */
export function callDahliaWindowHelper(request: DahliaWindowRequest): Promise<DahliaWindowAnswer> {
  return shared?.call(request) ?? Promise.resolve({ ok: false, error: 'The window helper runs only in the Windows app.' })
}

/** Answers "dahlia:window" requests: with the helper on Windows, with an explanation elsewhere. */
export function setupDahliaWindowHelper() {
  if (process.platform !== 'win32') {
    ipcMain.handle(DAHLIA_WINDOW_CHANNEL, () => ({ ok: false, error: 'Dahlia plays games only in the Windows app.' }))
    return
  }

  // Windows PowerShell 5.1 comes with every Windows; its .NET has the drawing classes the helper uses.
  const helper = withDahliaOutOfTheWay(createDahliaWindowHelper(() => spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    helperScript,
  ], { windowsHide: true })), {
    ownWindows: () => BrowserWindow.getAllWindows(),
    toDip: rect => screen.screenToDipRect(null, rect),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  })
  shared = helper
  ipcMain.handle(DAHLIA_WINDOW_CHANNEL, (_event, request: DahliaWindowRequest) => helper.call(request))
  app.on('before-quit', () => helper.dispose())
}
