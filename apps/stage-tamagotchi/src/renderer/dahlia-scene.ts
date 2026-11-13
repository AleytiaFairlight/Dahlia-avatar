// Dahlia: asks the desktop app's scene model what a picture shows (stage-ui libs/dahlia-scene.ts, main
// dahlia-scene-model.ts). The first time, the model's files are fetched from Dahlia's server; when her server
// doesn't have them, or anything fails, there is simply no scene and watching goes on without it.
// This file is Dahlia's (AIRI has no such file).

import type { DahliaScene } from '@proj-airi/stage-ui/libs/dahlia-scene'

import { DAHLIA_SCENE_GAP_MS, DAHLIA_SCENE_SIDE, parseDahliaScene, rgbFromRgba } from '@proj-airi/stage-ui/libs/dahlia-scene'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'

import { authHeaders } from './dahlia-game-player'

interface SceneAnswer { ok: boolean, installed?: boolean, json?: string, ms?: number, error?: string }

/** After a failed install it is tried again this much later, not on every capture. */
const RETRY_MS = 30 * 60_000
let ready: Promise<boolean> | undefined
let failedAt = 0
let lastAt = 0
let last: DahliaScene | undefined

function ask(request: Record<string, unknown>) {
  return window.electron.ipcRenderer.invoke('dahlia:scene', request) as Promise<SceneAnswer>
}

function ensure() {
  if (!ready && Date.now() - failedAt > RETRY_MS) {
    ready = (async () => {
      if ((await ask({ op: 'status' })).installed)
        return true
      const { 'Content-Type': _type, ...headers } = authHeaders() as Record<string, string>
      const installed = await ask({ op: 'install', base: SERVER_URL, headers })
      if (!installed.ok)
        throw new Error(installed.error)
      return true
    })().catch((error) => {
      console.warn('Dahlia: no scene model:', error)
      failedAt = Date.now()
      ready = undefined
      return false
    })
  }
  return ready ?? Promise.resolve(false)
}

/**
 * What the picture shows, or undefined without the model. At most one new description every few seconds; in
 * between, the last one is answered again (the screen it was made of is still much the same).
 */
export async function describeDahliaScreen(picture: HTMLImageElement): Promise<DahliaScene | undefined> {
  if (Date.now() - lastAt < DAHLIA_SCENE_GAP_MS)
    return last
  if (!await ensure())
    return undefined
  lastAt = Date.now()

  const scale = Math.min(1, DAHLIA_SCENE_SIDE / Math.max(picture.naturalWidth, picture.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale))
  const context = canvas.getContext('2d')!
  context.drawImage(picture, 0, 0, canvas.width, canvas.height)
  const rgb = rgbFromRgba(context.getImageData(0, 0, canvas.width, canvas.height).data)
  const answer = await ask({ op: 'describe', rgb: rgb.buffer, width: canvas.width, height: canvas.height })
  last = answer.ok && answer.json ? parseDahliaScene(answer.json) : undefined
  return last
}
