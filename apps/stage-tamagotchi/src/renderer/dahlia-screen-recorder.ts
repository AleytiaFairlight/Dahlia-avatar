// Dahlia: records a window or a screen of this PC for Dahlia, the way OBS does: Windows Graphics Capture
// (windows) or DXGI desktop duplication (screens) through Chromium, encoded by the GPU with MediaRecorder,
// MP4 (H.264) where Chromium can write it, WebM otherwise. The main process picks the source and saves the
// file in Videos\Dahlia (src/main/dahlia-screen-capture.ts). The "screen_record" tool of
// dahlia-remote-tools.ts uses it. This file is Dahlia's (AIRI has no such file).

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
const BITS_PER_SECOND = 8_000_000
/** The first that this Chromium can write: H.264 MP4 plays everywhere. */
const TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']

interface ScreenAnswer { ok: boolean, error?: string, [field: string]: unknown }

async function screenRequest(request: Record<string, unknown>) {
  const answer = await window.electron.ipcRenderer.invoke('dahlia:screen', request) as ScreenAnswer
  if (!answer.ok)
    throw new Error(answer.error ?? 'The capture failed.')
  return answer
}

async function windowRequest(request: Record<string, unknown>) {
  const answer = await window.electron.ipcRenderer.invoke('dahlia:window', request) as ScreenAnswer
  if (!answer.ok)
    throw new Error(answer.error ?? 'The window capture failed.')
  return answer
}

/** Waits until a video has painted a frame, so the first grab isn't the black frame before capture starts. */
async function waitForFrame(video: HTMLVideoElement) {
  // requestVideoFrameCallback fires once the window has actually produced a frame (Windows Graphics Capture
  // can take a moment for a game). Wait for two, since the very first can still be blank. A short timeout
  // keeps it from hanging where the callback is missing or never fires.
  const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback?.bind(video)
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    const timer = setTimeout(done, 500)
    if (rvfc) {
      rvfc(() => rvfc(() => {
        clearTimeout(timer)
        done()
      }))
    }
  })
}

/** Draws the current frame of a stream to a JPEG data URL at most maxHeight pixels high. */
async function frameFromStream(stream: MediaStream, maxHeight: number) {
  const video = document.createElement('video')
  video.muted = true
  video.srcObject = stream
  try {
    await video.play()
    await waitForFrame(video)
    const scale = Math.min(1, maxHeight / (video.videoHeight || maxHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((video.videoWidth || maxHeight) * scale))
    canvas.height = Math.max(1, Math.round((video.videoHeight || maxHeight) * scale))
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    return { image: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height }
  }
  catch {
    return undefined
  }
  finally {
    video.pause()
    video.srcObject = null
  }
}

/** One frame of the stream, at most 720 pixels high, as a JPEG data URL. */
async function still(stream: MediaStream) {
  return (await frameFromStream(stream, 720))?.image
}

export interface DahliaScreenshot {
  image: string
  width: number
  height: number
  title: string
}

/**
 * A screenshot of a window or a screen, through the same Windows Graphics Capture path the recorder uses.
 * The desktop capturer's own thumbnails come back black for games and other GPU-drawn windows, so the
 * screenshot tool grabs a live frame here instead. maxHeight bounds the picture; the default is 1080.
 */
export async function grabDahliaScreenshot(request: { window?: string, screen?: number, hwnd?: number, maxHeight?: number }): Promise<DahliaScreenshot> {
  const maxHeight = Math.min(2160, Math.max(360, Math.round(Number(request.maxHeight) || 1080)))
  const title = typeof request.window === 'string' ? request.window.trim() : ''

  // A window: Windows Graphics Capture by window comes back black for some GPU games (Dark War: Survival),
  // while a plain screen grab of the window reads it. The window helper does exactly that -- it brings the
  // window to the front and copies its visible frame from the screen, the same rectangle taps are measured
  // against. A whole screen keeps the capture path below, where desktop duplication sees the GPU fine.
  if (title || request.hwnd) {
    let hwnd = Number(request.hwnd) || 0
    let name = title
    if (!hwnd) {
      const found = await windowRequest({ op: 'find', title, anyApp: true })
      hwnd = Number(found.hwnd) || 0
      name = typeof found.title === 'string' && found.title ? found.title : title
    }
    const shot = await windowRequest({ op: 'capture', hwnd, maxHeight })
    const png = typeof shot.png === 'string' ? shot.png : ''
    if (png.length === 0)
      throw new Error('The screenshot came out blank.')
    return { image: `data:image/png;base64,${png}`, width: Number(shot.width) || 0, height: Number(shot.height) || 0, title: name }
  }

  let stream: MediaStream | undefined
  try {
    const source = await screenRequest({ op: 'record-source', window: request.window, screen: request.screen, hwnd: request.hwnd })
    try {
      const desktop: MediaStreamConstraints & { video: { mandatory: Record<string, unknown> } } = {
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.sourceId, maxFrameRate: 30, maxWidth: 3840, maxHeight: 2160 } },
      }
      stream = await navigator.mediaDevices.getUserMedia(desktop)
    }
    finally {
      await screenRequest({ op: 'record-done' }).catch(() => undefined)
    }
    const frame = await frameFromStream(stream, maxHeight)
    if (!frame)
      throw new Error('The screenshot came out blank.')
    return { ...frame, title: String(source.title ?? '') }
  }
  finally {
    stream?.getTracks().forEach(track => track.stop())
  }
}

let recording = false

/** Records for the seconds asked (or until the window closes) and saves the file. */
export async function recordDahliaScreen(request: DahliaRecordingRequest): Promise<DahliaRecording> {
  if (recording)
    throw new Error('A recording is already running.')
  recording = true
  let stream: MediaStream | undefined
  try {
    const seconds = Math.min(MAX_RECORDING_SECONDS, Math.max(1, Math.round(Number(request.seconds) || 10)))
    const source = await screenRequest({ op: 'record-source', window: request.window, screen: request.screen })
    try {
      // Chromium's desktop source constraint; the main process allowed this one source for a few seconds.
      const desktop: MediaStreamConstraints & { video: { mandatory: Record<string, unknown> } } = {
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.sourceId, maxFrameRate: 30, maxWidth: 1920, maxHeight: 1080 } },
      }
      stream = await navigator.mediaDevices.getUserMedia(desktop)
    }
    finally {
      await screenRequest({ op: 'record-done' }).catch(() => undefined)
    }

    const type = TYPES.find(candidate => MediaRecorder.isTypeSupported(candidate)) ?? ''
    const recorder = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: BITS_PER_SECOND })
    const chunks: Blob[] = []
    recorder.ondataavailable = event => event.data.size > 0 && chunks.push(event.data)
    const stopped = new Promise<void>(resolve => recorder.onstop = () => resolve())
    const startedAt = performance.now()
    recorder.start(1_000)

    // The window closing ends the track; the recording keeps what it has.
    const track = stream.getVideoTracks()[0]
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, seconds * 1000)
      track?.addEventListener('ended', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
    const frame = track?.readyState === 'live' ? await still(stream) : undefined
    recorder.stop()
    await stopped

    const blob = new Blob(chunks, { type: recorder.mimeType || type })
    if (blob.size === 0)
      throw new Error('The recording came out empty.')
    const saved = await screenRequest({
      op: 'save-recording',
      data: new Uint8Array(await blob.arrayBuffer()),
      extension: (recorder.mimeType || type).startsWith('video/mp4') ? 'mp4' : 'webm',
      title: String(source.title ?? ''),
    })
    return {
      path: String(saved.path),
      bytes: Number(saved.bytes),
      seconds: Math.round((performance.now() - startedAt) / 1000),
      title: String(source.title ?? ''),
      still: frame,
    }
  }
  finally {
    stream?.getTracks().forEach(track => track.stop())
    recording = false
  }
}
