// Dahlia: screenshots and screen recordings of this PC for Dahlia, on the "dahlia:screen" channel (the
// "screenshot" and "screen_record" tools of src/renderer/dahlia-remote-tools.ts). Both use the capture
// OBS and the Snipping Tool use: Chromium's desktop capturer takes windows with Windows Graphics Capture
// (it sees games that draw with the GPU, and windows behind other windows) and screens with DXGI desktop
// duplication. Screenshots are taken here; recordings run in the main window
// (src/renderer/dahlia-screen-recorder.ts, MediaRecorder with the GPU's encoder), which asks here for the
// source, and the file is saved here, in Videos\Dahlia. The window helper (dahlia-window-helper.ts) finds
// windows the way her game player does. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls setupDahliaScreenCapture() when the main process starts.

import type { DesktopCapturerSource, SourcesOptions } from 'electron'

import type { DahliaWindowAnswer, DahliaWindowRequest } from './dahlia-window-helper'

import path from 'node:path'
import process from 'node:process'

import { mkdir, writeFile } from 'node:fs/promises'

import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'

import { callDahliaWindowHelper } from './dahlia-window-helper'

export const DAHLIA_SCREEN_CHANNEL = 'dahlia:screen'

export type DahliaScreenRequest
  = | { op: 'screenshot', window?: string, hwnd?: number, screen?: number, maxHeight?: number }
    | { op: 'record-source', window?: string, screen?: number, hwnd?: number }
    | { op: 'record-done' }
    | { op: 'save-recording', data: Uint8Array, extension: string, title: string }

export type DahliaScreenshotAnswer
  = | { ok: true, image: string, width: number, height: number, name: string }
    | { ok: false, error: string }

const DEFAULT_MAX_HEIGHT = 1080
/** How long a recording source stays allowed for the recorder to open it. */
const ARMED_MS = 10_000
/** A minute of 1080p at the recorder's bitrate is about 60 MB; anything far bigger isn't a recording of hers. */
const MAX_RECORDING_BYTES = 400 * 1024 * 1024

export interface DahliaScreenDeps {
  getSources: (options: SourcesOptions) => Promise<DesktopCapturerSource[]>
  helper: (request: DahliaWindowRequest) => Promise<DahliaWindowAnswer>
  /** The capture ids of Dahlia's own windows, which a capture by title never takes. */
  ownSourceIds: () => string[]
  primaryDisplayId: () => string
  displayIds: () => string[]
  now: () => number
}

/** How well a window title fits the text asked for: 2 the same, 1 starts with it, 0 contains it, -1 not. */
export function titleRank(title: string, part: string) {
  const t = title.trim().toLowerCase()
  const p = part.trim().toLowerCase()
  if (!t || !p || !t.includes(p))
    return -1
  return t === p ? 2 : t.startsWith(p) ? 1 : 0
}

/** The best window source for the title: by rank, then the order Windows lists them (front first). */
export function pickWindowSource(sources: DesktopCapturerSource[], title: string, ownIds: string[]) {
  let best: DesktopCapturerSource | undefined
  let bestRank = -1
  for (const source of sources) {
    if (ownIds.includes(source.id))
      continue
    const rank = titleRank(source.name, title)
    if (rank > bestRank) {
      best = source
      bestRank = rank
    }
  }
  return best
}

/** The capture source of a window (by title or handle) or a screen (1, 2, …; the main one by default). */
export async function findSource(
  request: { window?: string, hwnd?: number, screen?: number },
  thumbnailSize: { width: number, height: number },
  deps: DahliaScreenDeps,
): Promise<{ ok: true, source: DesktopCapturerSource } | { ok: false, error: string }> {
  const title = typeof request.window === 'string' ? request.window.trim() : ''

  if (title || request.hwnd) {
    // The helper ranks titles the same way and skips hidden windows; its handle is in the source's id.
    let hwnd = Number(request.hwnd) || 0
    if (!hwnd) {
      const found = await deps.helper({ op: 'find', title, anyApp: true }).catch(() => undefined)
      if (found?.ok)
        hwnd = found.hwnd as number
    }
    const sources = await deps.getSources({ types: ['window'], thumbnailSize, fetchWindowIcons: false })
    const source = (hwnd ? sources.find(candidate => candidate.id.startsWith(`window:${hwnd}:`)) : undefined)
      ?? (title ? pickWindowSource(sources, title, deps.ownSourceIds()) : undefined)
    return source ? { ok: true, source } : { ok: false, error: title ? `No open window has "${title}" in its title.` : 'That window is gone.' }
  }

  const sources = await deps.getSources({ types: ['screen'], thumbnailSize, fetchWindowIcons: false })
  if (sources.length === 0)
    return { ok: false, error: 'Windows listed no screens to capture.' }
  const number = Math.round(Number(request.screen) || 0)
  const order = deps.displayIds()
  const wanted = number >= 1 ? order[number - 1] : deps.primaryDisplayId()
  if (number >= 1 && !wanted)
    return { ok: false, error: `This PC has ${order.length} screen${order.length === 1 ? '' : 's'}.` }
  return { ok: true, source: sources.find(source => source.display_id === wanted) ?? sources[0] }
}

/** A screenshot of one window or screen, as a JPEG data URL at most maxHeight pixels high. */
export async function takeScreenshot(request: Extract<DahliaScreenRequest, { op: 'screenshot' }>, deps: DahliaScreenDeps): Promise<DahliaScreenshotAnswer> {
  const maxHeight = Math.min(2160, Math.max(360, Math.round(Number(request.maxHeight) || DEFAULT_MAX_HEIGHT)))
  const found = await findSource(request, { width: maxHeight * 4, height: maxHeight }, deps)
  if (!found.ok)
    return found
  const image = found.source.thumbnail
  if (image.isEmpty())
    return { ok: false, error: `Windows gave an empty picture of "${found.source.name}". Is it minimized?` }
  const { width, height } = image.getSize()
  return { ok: true, image: `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`, width, height, name: found.source.name }
}

let armedUntil = 0

/**
 * Whether Dahlia's recorder may open a desktop capture now. AIRI grants desktop capture only for a source
 * its own picker chose; this is the same for her recorder: armed by "record-source" for a few seconds, until
 * the recorder has its stream ("record-done").
 */
export function isDahliaCaptureArmed(now = Date.now()) {
  return now < armedUntil
}

/** A file name from a window title: no characters Windows forbids, not too long. */
export function recordingFileName(title: string, extension: string, at: Date) {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Screen'
  const stamp = at.toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-')
  return `Dahlia - ${name} - ${stamp}.${extension === 'mp4' ? 'mp4' : 'webm'}`
}

function electronDeps(): DahliaScreenDeps {
  return {
    getSources: options => desktopCapturer.getSources(options),
    helper: callDahliaWindowHelper,
    ownSourceIds: () => BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).map(window => window.getMediaSourceId()),
    primaryDisplayId: () => String(screen.getPrimaryDisplay().id),
    displayIds: () => screen.getAllDisplays().map(display => String(display.id)),
    now: () => Date.now(),
  }
}

async function answer(request: DahliaScreenRequest) {
  switch (request?.op) {
    case 'screenshot':
      return await takeScreenshot(request, electronDeps())
    case 'record-source': {
      // No thumbnails: only the id is needed.
      const found = await findSource(request, { width: 0, height: 0 }, electronDeps())
      if (!found.ok)
        return found
      armedUntil = Date.now() + ARMED_MS
      return { ok: true, sourceId: found.source.id, title: found.source.name }
    }
    case 'record-done':
      armedUntil = 0
      return { ok: true }
    case 'save-recording': {
      if (!(request.data instanceof Uint8Array) || request.data.byteLength === 0 || request.data.byteLength > MAX_RECORDING_BYTES)
        return { ok: false, error: 'The recording is empty or too big.' }
      const folder = path.join(app.getPath('videos'), 'Dahlia')
      await mkdir(folder, { recursive: true })
      const file = path.join(folder, recordingFileName(String(request.title ?? ''), String(request.extension), new Date()))
      await writeFile(file, request.data)
      return { ok: true, path: file, bytes: request.data.byteLength }
    }
    default:
      return { ok: false, error: 'Unknown request.' }
  }
}

/** Answers "dahlia:screen" requests: on Windows only. */
export function setupDahliaScreenCapture() {
  ipcMain.handle(DAHLIA_SCREEN_CHANNEL, async (_event, request: DahliaScreenRequest) => {
    if (process.platform !== 'win32')
      return { ok: false, error: 'Screenshots and recordings work only in the Windows app.' }
    try {
      return await answer(request)
    }
    catch (error) {
      return { ok: false, error: (error as Error).message || 'The capture failed.' }
    }
  })
}
