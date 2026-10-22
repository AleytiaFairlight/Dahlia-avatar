// Dahlia: tests for dahlia-window-helper.ts, the main process's side of the game window helper.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { createDahliaWindowHelper } from './dahlia-window-helper'

vi.mock('electron', () => ({ app: { on: vi.fn() }, ipcMain: { handle: vi.fn() } }))
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
