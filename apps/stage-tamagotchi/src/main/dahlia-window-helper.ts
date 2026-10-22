// Dahlia: runs resources/dahlia-window-helper.ps1, which finds, captures and taps a game window on Windows,
// and answers the renderer's requests to it on the "dahlia:window" channel, for her game player
// (src/renderer/dahlia-game-player.ts). This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls setupDahliaWindowHelper() when the main process starts.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import { app, ipcMain } from 'electron'

import helperScript from '../../resources/dahlia-window-helper.ps1?asset&asarUnpack'

export const DAHLIA_WINDOW_CHANNEL = 'dahlia:window'

export type DahliaWindowRequest
  = | { op: 'find', title: string }
    | { op: 'capture', hwnd: number, maxHeight: number }
    | { op: 'tap', hwnd: number, x: number, y: number }
    | { op: 'swipe', hwnd: number, x1: number, y1: number, x2: number, y2: number, ms: number }
    | { op: 'key', hwnd: number, key: 'escape' | 'enter' | 'space' }

export type DahliaWindowAnswer = { ok: true, [field: string]: unknown } | { ok: false, error: string }

const OPS = new Set(['find', 'capture', 'tap', 'swipe', 'key'])
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

/** Answers "dahlia:window" requests: with the helper on Windows, with an explanation elsewhere. */
export function setupDahliaWindowHelper() {
  if (process.platform !== 'win32') {
    ipcMain.handle(DAHLIA_WINDOW_CHANNEL, () => ({ ok: false, error: 'Dahlia plays games only in the Windows app.' }))
    return
  }

  // Windows PowerShell 5.1 comes with every Windows; its .NET has the drawing classes the helper uses.
  const helper = createDahliaWindowHelper(() => spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    helperScript,
  ], { windowsHide: true }))
  ipcMain.handle(DAHLIA_WINDOW_CHANNEL, (_event, request: DahliaWindowRequest) => helper.call(request))
  app.on('before-quit', () => helper.dispose())
}
