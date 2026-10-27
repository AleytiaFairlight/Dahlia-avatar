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

/** One frame of the stream, at most 720 pixels high. */
async function still(stream: MediaStream) {
  const video = document.createElement('video')
  video.muted = true
  video.srcObject = stream
  try {
    await video.play()
    const scale = Math.min(1, 720 / (video.videoHeight || 720))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  }
  catch {
    return undefined
  }
  finally {
    video.pause()
    video.srcObject = null
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
