// Dahlia: PC awareness on this PC: the stage-ui loop (libs/dahlia-pc-awareness.ts) with this PC's state from the
// main process (src/main/dahlia-pc-state.ts) and her server, which keeps the newest report in her prompt for this
// person's chats (/api/v1/dahlia/pc/state). It runs while the person turned it on in Settings > Modules > Vision
// (off until they do), and while she watches the screen, which they asked for. The main window runs it
// (dahlia-screen-watch.ts starts it). This file is Dahlia's (AIRI has no such file).

import type { DahliaPcAwarenessState, DahliaPcReport, DahliaPcSample } from '@proj-airi/stage-ui/libs/dahlia-pc-awareness'

import { DAHLIA_PC_AWARENESS_KEY, DAHLIA_PC_AWARENESS_STATUS_KEY, DahliaPcAwareness } from '@proj-airi/stage-ui/libs/dahlia-pc-awareness'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'

import { authHeaders } from './dahlia-game-player'

let awareness: DahliaPcAwareness | undefined
let watching = false

async function post(path: string, body: unknown) {
  const response = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const answer = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined
    throw new Error(answer?.error?.message ?? `Dahlia's server answered ${response.status}.`)
  }
}

function turnedOn() {
  return localStorage.getItem(DAHLIA_PC_AWARENESS_KEY) === 'on'
}

function apply() {
  if (!awareness)
    return
  if (turnedOn() || watching)
    void awareness.start()
  else
    void awareness.stop()
}

/** Whether she watches the screen right now: PC awareness runs along with it. */
export function syncDahliaPcAwareness(screenWatched: boolean) {
  if (watching === screenWatched)
    return
  watching = screenWatched
  apply()
}

/** Sets PC awareness up in the main window (dahlia-screen-watch.ts calls this from startDahliaScreenWatcher). */
export function startDahliaPcAwareness() {
  if (awareness)
    return
  const save = (state: DahliaPcAwarenessState) => localStorage.setItem(DAHLIA_PC_AWARENESS_STATUS_KEY, JSON.stringify(state))
  awareness = new DahliaPcAwareness({
    sample: async () => await window.electron.ipcRenderer.invoke('dahlia:pc-state') as DahliaPcSample,
    report: (report: DahliaPcReport) => post('/api/v1/dahlia/pc/state', report),
    stop: () => post('/api/v1/dahlia/pc/stop', {}),
    onState: save,
  })
  save(awareness.state)
  apply()

  // Settings > Modules > Vision is another window: its switch writes the key.
  window.addEventListener('storage', (event) => {
    if (event.key === DAHLIA_PC_AWARENESS_KEY)
      apply()
  })
}
