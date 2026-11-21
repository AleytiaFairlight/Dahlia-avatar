// Dahlia: screenshots and screen recordings of this PC for Dahlia, the way OBS does: the Godot host copies a
// game window's frame from the screen (Windows Graphics Capture through the window
// helper: it sees games that draw with the GPU, and windows behind other windows) and
// records windows and whole screens itself (ScreenRecorderLib: DXGI desktop duplication,
// Media Foundation H.264). The host answers on the "dahlia:screen" channel and saves files
// in Videos\Dahlia (src-godot/scripts/dahlia-screen-capture.cs, src-godot/scripts/dahlia-screen-recording.cs).
// A port of Electron's src/renderer/dahlia-screen-recorder.ts.
//
// Difference from Electron: the Kirie webview has no Chromium desktop capturer, so there
// is no MediaRecorder path: record-source starts the host's recorder and record-done stops
// it into Videos\Dahlia. Screenshots still come from the host's capture path below.

import type { DahliaScreenWord } from '@proj-airi/stage-ui/libs/dahlia-game-player'

import { parseScreenWords } from '@proj-airi/stage-ui/libs/dahlia-game-player'

import { dahliaScreen, dahliaWindow } from './dahlia-host'

export interface DahliaRecordingRequest {
  window?: string
  screen?: number
  seconds?: number
}

export interface DahliaRecording {
  path: string
  bytes: number
  seconds: number
  title: string
  /** The last frame, as a JPEG data URL, so she sees what was recorded. */
  still?: string
}

/** Device calls wait 90 s on her server; a recording and saving it must fit. */
export const MAX_RECORDING_SECONDS = 60

export interface DahliaScreenshot {
  image: string
  width: number
  height: number
  title: string
  /** The words Windows read on a window's capture, when asked for (ocr) and it could. */
  words?: DahliaScreenWord[]
  /** A window capture's 16x16 grayscale thumbnail, to tell whether the screen changed. */
  sig?: string
}

/**
 * A screenshot of a window or a screen, through the same per-window capture path the
 * game player taps with. maxHeight bounds the picture; the default is 1080.
 */
export async function grabDahliaScreenshot(request: { window?: string, screen?: number, hwnd?: number, maxHeight?: number, ocr?: boolean }): Promise<DahliaScreenshot> {
  const maxHeight = Math.min(2160, Math.max(360, Math.round(Number(request.maxHeight) || 1080)))
  const title = typeof request.window === 'string' ? request.window.trim() : ''

  // A window: the helper brings it to the front and copies its frame from the screen,
  // the rectangle taps use. Screens are copied by the host below.
  if (title || request.hwnd) {
    let hwnd = Number(request.hwnd) || 0
    let name = title
    if (!hwnd) {
      const found = await dahliaWindow({ op: 'find', title, anyApp: true })
      hwnd = Number(found.hwnd) || 0
      name = typeof found.title === 'string' && found.title ? found.title : title
    }
    const shot = await dahliaWindow({ op: 'capture', hwnd, maxHeight, ...(request.ocr ? { ocr: true } : {}) })
    const png = typeof shot.png === 'string' ? shot.png : ''
    if (png.length === 0)
      throw new Error('The screenshot came out blank.')
    if (typeof shot.ocrError === 'string')
      console.warn('Dahlia: Windows couldn\'t read the screen\'s text:', shot.ocrError)
    return {
      image: `data:image/png;base64,${png}`,
      width: Number(shot.width) || 0,
      height: Number(shot.height) || 0,
      title: name,
      words: parseScreenWords(shot.words),
      sig: typeof shot.sig === 'string' && shot.sig ? shot.sig : undefined,
    }
  }

  const shot = await dahliaScreen({ op: 'screenshot', window: request.window, screen: request.screen, maxHeight })
  const image = typeof shot.image === 'string' ? shot.image : ''
  if (!image)
    throw new Error('The screenshot came out blank.')
  return { image, width: Number(shot.width) || 0, height: Number(shot.height) || 0, title: String(shot.name ?? '') }
}

/** The host records, so one recording runs at a time, like Electron's recorder flag. */
let recording = false

/**
 * Records for the seconds asked (or until "record-done") and saves the file: the host's
 * recorder (ScreenRecorderLib) captures the window or screen while this waits, then this
 * stops it into Videos\Dahlia. The last frame comes from a screenshot afterwards.
 */
export async function recordDahliaScreen(request: DahliaRecordingRequest): Promise<DahliaRecording> {
  if (recording)
    throw new Error('A recording is already running.')
  recording = true
  try {
    const seconds = Math.min(MAX_RECORDING_SECONDS, Math.max(1, Math.round(Number(request.seconds) || 10)))
    const started = await dahliaScreen({ op: 'record-source', window: request.window, screen: request.screen })
    const name = typeof started.title === 'string' && started.title ? started.title : ''
    await new Promise(resolve => setTimeout(resolve, seconds * 1000))
    const done = await dahliaScreen({ op: 'record-done' })
    // The host saved the file; take a screenshot so she sees the last frame.
    let still: string | undefined
    try {
      still = (await grabDahliaScreenshot({ window: request.window, screen: request.screen })).image
    }
    catch (error) {
      console.warn('Dahlia: couldn\'t grab the recording\'s last frame:', error)
    }
    return {
      path: String(done.path),
      bytes: Number(done.bytes),
      seconds: Number(done.seconds) || seconds,
      title: (typeof done.title === 'string' && done.title ? done.title : name) || 'Screen',
      still,
    }
  }
  finally {
    recording = false
  }
}
