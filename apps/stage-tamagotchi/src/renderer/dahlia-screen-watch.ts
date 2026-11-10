// Dahlia: Dahlia keeps an eye on this PC's screen when asked to: the stage-ui loop (libs/dahlia-screen-watch.ts)
// with this PC's screen capture (dahlia-screen-recorder.ts, the whole screen, which takes no window to the front)
// and her server, which notes what each changed capture shows (/api/v1/dahlia/screen/look). Started by her
// screen_watch tool (dahlia-remote-tools.ts) or Settings > Modules > Vision; the main window runs it
// (dahlia-game-player.ts starts it). This file is Dahlia's (AIRI has no such file).

import type { DahliaScreenCapture, DahliaScreenWatchState } from '@proj-airi/stage-ui/libs/dahlia-screen-watch'

import { screenChanged } from '@proj-airi/stage-ui/libs/dahlia-game-player'
import { DAHLIA_SCREEN_WATCH_COMMAND_KEY, DAHLIA_SCREEN_WATCH_STATUS_KEY, DahliaScreenWatcher } from '@proj-airi/stage-ui/libs/dahlia-screen-watch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'

import { authHeaders } from './dahlia-game-player'
import { grabDahliaScreenshot } from './dahlia-screen-recorder'

let watcher: DahliaScreenWatcher | undefined

/** A 16x16 grayscale thumbnail of the picture, as the window helper makes for its captures. */
async function signatureOf(image: string) {
  const picture = new Image()
  picture.src = image
  await picture.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  const context = canvas.getContext('2d')!
  context.drawImage(picture, 0, 0, 16, 16)
  const pixels = context.getImageData(0, 0, 16, 16).data
  let gray = ''
  for (let i = 0; i < pixels.length; i += 4)
    gray += String.fromCharCode(Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114))
  return btoa(gray)
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const answer = await response.json().catch(() => undefined) as { error?: { message?: string }, summary?: string, busy?: boolean } | undefined
  if (!response.ok)
    throw new Error(answer?.error?.message ?? `Dahlia's server answered ${response.status}.`)
  return answer
}

/** The watcher of this window; undefined outside the main window. */
export function dahliaScreenWatcher() {
  return watcher
}

/** Starts watching the screen, or restarts with new settings. */
export function startWatchingDahliaScreen(session: { screen?: number, seconds?: number, minutes?: number } = {}) {
  if (!watcher)
    throw new Error('Watching runs in the main window.')
  void watcher.start(session)
  return watcher.state
}

/** Sets the watcher up in the main window (dahlia-game-player.ts calls this from startDahliaGamePlayer). */
export function startDahliaScreenWatcher() {
  if (watcher)
    return
  const save = (state: DahliaScreenWatchState) => localStorage.setItem(DAHLIA_SCREEN_WATCH_STATUS_KEY, JSON.stringify(state))
  watcher = new DahliaScreenWatcher({
    capture: async (screen): Promise<DahliaScreenCapture> => {
      const shot = await grabDahliaScreenshot({ screen, maxHeight: 900 })
      return { image: shot.image, signature: await signatureOf(shot.image), source: shot.title || 'the main screen' }
    },
    look: async capture => (await post('/api/v1/dahlia/screen/look', { image: capture.image, source: capture.source }))?.summary,
    stop: async () => void await post('/api/v1/dahlia/screen/stop', {}),
    changed: screenChanged,
    onState: save,
  })
  save(watcher.state)

  // Settings > Modules > Vision is another window: its Start and Stop buttons write a command here.
  window.addEventListener('storage', (event) => {
    if (event.key !== DAHLIA_SCREEN_WATCH_COMMAND_KEY || !event.newValue)
      return
    const command = JSON.parse(event.newValue) as { op: 'start' | 'stop' }
    if (command.op === 'start')
      void watcher?.start()
    else
      void watcher?.stop()
  })
}
