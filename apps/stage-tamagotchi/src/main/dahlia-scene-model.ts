// Dahlia: the scene model in the desktop app (see stage-ui libs/dahlia-scene.ts). The renderer asks on the
// "dahlia:scene" channel: {op: 'status'} whether its files are here, {op: 'install', base, headers} to get them
// from Dahlia's server (each checked against its SHA-256 before it is kept), and {op: 'describe', rgb, width,
// height} for what a picture shows. The model runs in a worker thread (resources/dahlia-scene-worker.cjs), which
// is started on the first picture and stopped after ten idle minutes, since it holds about 100 MB.
// This file is Dahlia's (AIRI has no such file); dahlia-window-helper.ts sets it up.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { errorMessageFrom } from '@moeru/std'
import { DAHLIA_SCENE_FILES } from '@proj-airi/stage-ui/libs/dahlia-scene'
import { app, ipcMain } from 'electron'

import workerScript from '../../resources/dahlia-scene-worker.cjs?asset&asarUnpack'

export const DAHLIA_SCENE_CHANNEL = 'dahlia:scene'
const IDLE_MS = 10 * 60_000
const DESCRIBE_TIMEOUT_MS = 30_000

type SceneRequest
  = | { op: 'status' }
    | { op: 'install', base: string, headers: Record<string, string> }
    | { op: 'describe', rgb: ArrayBuffer, width: number, height: number }

function sha256(data: Uint8Array) {
  return createHash('sha256').update(data).digest('hex')
}

export function createDahliaSceneModel(dir: string, startWorker: (dir: string) => Worker = folder => new Worker(workerScript, { workerData: { dir: folder } })) {
  let worker: Worker | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let nextId = 1
  const waiting = new Map<number, (answer: { ok: boolean, json?: string, ms?: number, error?: string }) => void>()

  /** Whether every file is here with the right content. */
  function installed() {
    return DAHLIA_SCENE_FILES.every(({ name, sha256: expected }) => {
      const file = join(dir, name)
      return existsSync(file) && sha256(readFileSync(file)) === expected
    })
  }

  let checked: boolean | undefined
  function stop() {
    void worker?.terminate()
    worker = undefined
    for (const answer of waiting.values())
      answer({ ok: false, error: 'The scene model stopped.' })
    waiting.clear()
  }

  async function install(base: string, headers: Record<string, string>) {
    mkdirSync(dir, { recursive: true })
    for (const { name, sha256: expected } of DAHLIA_SCENE_FILES) {
      const file = join(dir, name)
      if (existsSync(file) && sha256(readFileSync(file)) === expected)
        continue
      const response = await fetch(`${base.replace(/\/$/, '')}/api/v1/dahlia/models/scene/${name}`, { headers })
      if (!response.ok)
        throw new Error(response.status === 404 ? 'Dahlia\'s server doesn\'t have the scene model.' : `Dahlia's server answered ${response.status} for ${name}.`)
      const data = new Uint8Array(await response.arrayBuffer())
      // Code and weights that run in this app: only the exact files that were tried are kept.
      if (sha256(data) !== expected)
        throw new Error(`${name} from Dahlia's server isn't the file expected.`)
      writeFileSync(`${file}.part`, data)
      renameSync(`${file}.part`, file)
    }
    checked = true
  }

  function describe(rgb: ArrayBuffer, width: number, height: number) {
    worker ??= startWorker(dir)
      .on('message', (message: { id: number, ok: boolean }) => {
        waiting.get(message.id)?.(message)
        waiting.delete(message.id)
      })
      .on('error', () => stop())
    clearTimeout(idle)
    idle = setTimeout(stop, IDLE_MS)
    const id = nextId++
    return new Promise<{ ok: boolean, json?: string, ms?: number, error?: string }>((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id)
        resolve({ ok: false, error: 'The scene model took too long.' })
      }, DESCRIBE_TIMEOUT_MS)
      waiting.set(id, (answer) => {
        clearTimeout(timer)
        resolve(answer)
      })
      worker!.postMessage({ id, op: 'describe', rgb, width, height }, [rgb])
    })
  }

  return {
    async handle(request: SceneRequest) {
      try {
        if (request?.op === 'status')
          return { ok: true, installed: checked ??= installed() }
        if (request?.op === 'install') {
          await install(String(request.base), request.headers ?? {})
          return { ok: true, installed: true }
        }
        if (request?.op === 'describe') {
          if (!(checked ??= installed()))
            return { ok: false, error: 'The scene model isn\'t installed.' }
          return await describe(request.rgb, Number(request.width), Number(request.height))
        }
        return { ok: false, error: 'Unknown request.' }
      }
      catch (error) {
        return { ok: false, error: errorMessageFrom(error) ?? String(error) }
      }
    },
    stop,
  }
}

export function setupDahliaSceneModel() {
  const model = createDahliaSceneModel(join(app.getPath('userData'), 'dahlia-scene-model'))
  ipcMain.handle(DAHLIA_SCENE_CHANNEL, (_event, request: SceneRequest) => model.handle(request))
  app.on('before-quit', () => model.stop())
}
