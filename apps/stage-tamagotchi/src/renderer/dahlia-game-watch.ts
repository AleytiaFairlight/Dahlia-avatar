// Dahlia: Dahlia watches Aleytia play Dark War: Survival on this PC, to learn the game: the stage-ui watcher
// (libs/dahlia-game-watch.ts) with this PC's window helper (src/main/dahlia-window-helper.ts: a capture while the
// game is in front, and a mouse hook that notes Aleytia's own clicks on it) and her server, which keeps the
// samples (/api/v1/dahlia/game/learn). Started from Settings > Dahlia or by Dahlia's game_watch tool
// (dahlia-remote-tools.ts); the main window runs it (dahlia-game-player.ts starts it). This file is Dahlia's
// (AIRI has no such file).

import type { DahliaGameWatchState, DahliaWatchGesture, DahliaWatchSample } from '@proj-airi/stage-ui/libs/dahlia-game-watch'

import { DahliaGameWatcher } from '@proj-airi/stage-ui/libs/dahlia-game-watch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'

import { authHeaders, dahliaGamePlayer, DARK_WAR_LAUNCHER_TITLE, DARK_WAR_SURVIVAL, DARK_WAR_WINDOW_TITLE, windowRequest } from './dahlia-game-player'

/** The watcher's state, for Settings > Dahlia. */
export const DAHLIA_GAME_WATCH_STATUS_KEY = 'dahlia/game-watch-status'

let watcher: DahliaGameWatcher | undefined

async function post(path: string, body: unknown, timeoutMs = 60_000) {
  const response = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const answer = await response.json().catch(() => undefined) as { error?: { message?: string }, message?: string } | undefined
  if (!response.ok)
    throw new Error(answer?.error?.message ?? `Dahlia's server answered ${response.status}.`)
  return answer
}

/** The watcher of this window; undefined outside the main window. */
export function dahliaGameWatcher() {
  return watcher
}

/** Starts watching Aleytia play, or gives the running session a new time. */
export function startWatchingDahliaGame(session: { windowTitle?: string, minutes?: number } = {}) {
  if (!watcher)
    throw new Error('Watching runs in the main window.')
  if (dahliaGamePlayer()?.state.running)
    throw new Error('Dahlia is playing right now; stop her first.')
  const windowTitle = session.windowTitle?.trim()
  void watcher.start({
    game: DARK_WAR_SURVIVAL,
    windowTitle: !windowTitle || windowTitle === DARK_WAR_LAUNCHER_TITLE ? DARK_WAR_WINDOW_TITLE : windowTitle,
    minutes: session.minutes,
  })
  return watcher.state
}

/** Sets the watcher up in the main window (dahlia-game-player.ts calls this from startDahliaGamePlayer). */
export function startDahliaGameWatcher() {
  if (watcher)
    return
  watcher = new DahliaGameWatcher({
    window: {
      find: async (title) => {
        const answer = await windowRequest({ op: 'find', title })
        return { hwnd: answer.hwnd as number, title: answer.title as string }
      },
      peek: async (hwnd, maxHeight) => {
        const answer = await windowRequest({ op: 'peek', hwnd, maxHeight })
        return answer.inFront && typeof answer.jpeg === 'string' ? `data:image/jpeg;base64,${answer.jpeg}` : undefined
      },
      events: async (hwnd) => {
        const answer = await windowRequest({ op: 'watch-events', hwnd })
        const rows = JSON.parse(String(answer.events ?? '[]')) as number[][]
        return rows.map(([x1, y1, x2, y2, at, ms]): DahliaWatchGesture => ({ x1, y1, x2, y2, at, ms }))
      },
      stop: async () => void await windowRequest({ op: 'watch-stop' }),
    },
    upload: async (sample: DahliaWatchSample) => void await post('/api/v1/dahlia/game/learn', sample),
    // Her server writes her notes from the session before it answers, which takes a few minutes at most.
    end: async (game, session) => (await post('/api/v1/dahlia/game/learn/end', { game, session }, 300_000))?.message,
    onState: (state: DahliaGameWatchState) => localStorage.setItem(DAHLIA_GAME_WATCH_STATUS_KEY, JSON.stringify(state)),
  })
  localStorage.setItem(DAHLIA_GAME_WATCH_STATUS_KEY, JSON.stringify(watcher.state))
}
