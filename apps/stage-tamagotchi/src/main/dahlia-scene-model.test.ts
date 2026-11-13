// Dahlia: tests for dahlia-scene-model.ts, the scene model's files and worker in the desktop app.
import type { Worker } from 'node:worker_threads'

import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDahliaSceneModel } from './dahlia-scene-model'

const files: Record<string, string> = { 'cactus.js': 'js', 'cactus.wasm': 'wasm', 'mirage.cact': 'weights' }
vi.mock('electron', () => ({ app: { on: vi.fn(), getPath: vi.fn() }, ipcMain: { handle: vi.fn() } }))
vi.mock('../../resources/dahlia-scene-worker.cjs?asset&asarUnpack', () => ({ default: '/app/dahlia-scene-worker.cjs' }))
vi.mock('@proj-airi/stage-ui/libs/dahlia-scene', () => ({
  DAHLIA_SCENE_FILES: ['cactus.js', 'cactus.wasm', 'mirage.cact'].map(name => ({
    name,
    sha256: createHash('sha256').update({ 'cactus.js': 'js', 'cactus.wasm': 'wasm', 'mirage.cact': 'weights' }[name]!).digest('hex'),
  })),
}))

const dirs: string[] = []
function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'dahlia-scene-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function serve(content: Record<string, string>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const name = url.split('/').at(-1)!
    return name in content ? new Response(content[name]) : new Response('', { status: 404 })
  }))
}

describe('dahlia scene model', () => {
  it('fetches its files from her server and keeps only the ones with the right checksum', async () => {
    const dir = folder()
    const model = createDahliaSceneModel(dir)
    expect(await model.handle({ op: 'status' })).toEqual({ ok: true, installed: false })
    expect(await model.handle({ op: 'describe', rgb: new ArrayBuffer(3), width: 1, height: 1 })).toMatchObject({ ok: false })

    serve({ ...files, 'mirage.cact': 'something else' })
    expect(await model.handle({ op: 'install', base: 'https://dahlia.test/', headers: {} })).toMatchObject({ ok: false, error: expect.stringContaining('mirage.cact') })
    expect(existsSync(join(dir, 'mirage.cact')), 'a wrong file is not kept').toBe(false)

    serve({ 'cactus.js': 'js' })
    expect(await model.handle({ op: 'install', base: 'https://dahlia.test', headers: {} })).toMatchObject({ ok: false, error: expect.stringContaining('doesn\'t have') })

    serve(files)
    expect(await model.handle({ op: 'install', base: 'https://dahlia.test', headers: { Authorization: 'Bearer k' } })).toEqual({ ok: true, installed: true })
    expect(await createDahliaSceneModel(dir).handle({ op: 'status' })).toEqual({ ok: true, installed: true })
  })

  it('asks its worker what a picture shows', async () => {
    const dir = folder()
    serve(files)
    const worker = Object.assign(new EventEmitter(), {
      terminate: vi.fn(async () => 0),
      postMessage: vi.fn((message: { id: number }) => queueMicrotask(() => worker.emit('message', { id: message.id, ok: true, json: '{"objects":[]}', ms: 5 }))),
    })
    const model = createDahliaSceneModel(dir, () => worker as unknown as Worker)
    await model.handle({ op: 'install', base: 'https://dahlia.test', headers: {} })
    expect(await model.handle({ op: 'describe', rgb: new ArrayBuffer(12), width: 2, height: 2 })).toMatchObject({ ok: true, json: '{"objects":[]}' })
    model.stop()
    expect(worker.terminate).toHaveBeenCalled()
  })
})
