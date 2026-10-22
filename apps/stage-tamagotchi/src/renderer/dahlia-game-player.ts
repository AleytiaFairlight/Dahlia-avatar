// Dahlia: Dahlia plays a game in its window on this PC (Dark War: Survival). The main process's window helper
// captures and taps the window (src/main/dahlia-window-helper.ts); her server chooses each move and keeps her
// notes about the game. She starts from Settings > Dahlia (in another window: the request travels through
// localStorage) or from her other devices (src/renderer/dahlia-remote-tools.ts). This file is Dahlia's (AIRI
// has no such file); scripts/apply_avatar_branding.sh starts it in the main window.

import type { DahliaGameSession, DahliaGameState, DahliaGameStep } from '@proj-airi/stage-ui/libs/dahlia-game-player'

import { DahliaGamePlayer } from '@proj-airi/stage-ui/libs/dahlia-game-player'
import { DAHLIA_CHAT_PROVIDER_ID } from '@proj-airi/stage-ui/libs/providers/providers/dahlia'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'

import { resolveInitialRendererRoutePath } from './window-context'

/** A start or stop from Settings > Dahlia: {action, goal, minutes, windowTitle, at}. */
export const DAHLIA_GAME_REQUEST_KEY = 'dahlia/game-request'
/** The player's state, for Settings > Dahlia. */
export const DAHLIA_GAME_STATUS_KEY = 'dahlia/game-status'

export const DARK_WAR_SURVIVAL = 'dark-war-survival'
export const DEFAULT_GAME_GOAL = 'Collect free rewards and resources, finish the daily quests, upgrade buildings and train troops.'

let player: DahliaGamePlayer | undefined

interface WindowAnswer { ok: boolean, error?: string, [field: string]: unknown }

async function windowRequest(request: Record<string, unknown>) {
  const answer = await window.electron.ipcRenderer.invoke('dahlia:window', request) as WindowAnswer
  if (!answer.ok)
    throw new Error(answer.error ?? 'The window helper failed.')
  return answer
}

function apiKey() {
  const key = useProviderConfigStore().getProviderConfig(DAHLIA_CHAT_PROVIDER_ID)?.apiKey
  if (typeof key !== 'string' || !key)
    throw new Error('Save the Dahlia key first.')
  return key
}

async function step(request: Parameters<ConstructorParameters<typeof DahliaGamePlayer>[0]['step']>[0]): Promise<DahliaGameStep> {
  const response = await fetch(`${SERVER_URL}/api/v1/dahlia/game/step`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(240_000),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined
    throw new Error(body?.error?.message ?? `Dahlia's server answered ${response.status}.`)
  }
  return await response.json() as DahliaGameStep
}

/** The player of this window; undefined outside the main window. */
export function dahliaGamePlayer() {
  return player
}

/** Starts a session, or changes the running one. */
export function startDahliaGame(session: Partial<DahliaGameSession> = {}) {
  if (!player)
    throw new Error('The game player runs in the main window.')
  void player.start({
    game: DARK_WAR_SURVIVAL,
    windowTitle: session.windowTitle?.trim() || 'Dark War',
    goal: session.goal?.trim() || DEFAULT_GAME_GOAL,
    minutes: session.minutes ?? 30,
  })
  return player.state
}

/** Starts the player in the main window only: every window runs this code. */
export function startDahliaGamePlayer() {
  if (player || resolveInitialRendererRoutePath('/') !== '/')
    return

  player = new DahliaGamePlayer({
    window: {
      find: async (title) => {
        const answer = await windowRequest({ op: 'find', title })
        return { hwnd: answer.hwnd as number, title: answer.title as string }
      },
      capture: async (hwnd, maxHeight) => ({ png: (await windowRequest({ op: 'capture', hwnd, maxHeight })).png as string }),
      tap: async (hwnd, x, y) => void await windowRequest({ op: 'tap', hwnd, x, y }),
      swipe: async (hwnd, x1, y1, x2, y2, ms) => void await windowRequest({ op: 'swipe', hwnd, x1, y1, x2, y2, ms }),
      back: async hwnd => void await windowRequest({ op: 'key', hwnd, key: 'escape' }),
    },
    step,
    onState: (state: DahliaGameState) => localStorage.setItem(DAHLIA_GAME_STATUS_KEY, JSON.stringify(state)),
  })
  localStorage.setItem(DAHLIA_GAME_STATUS_KEY, JSON.stringify(player.state))

  // Settings > Dahlia is another window; its requests arrive as storage events here.
  window.addEventListener('storage', (event) => {
    if (event.key !== DAHLIA_GAME_REQUEST_KEY || !event.newValue)
      return
    try {
      const request = JSON.parse(event.newValue) as { action?: string } & Partial<DahliaGameSession>
      if (request.action === 'stop')
        player?.stop()
      else if (request.action === 'start')
        startDahliaGame(request)
    }
    catch (error) {
      console.warn('Dahlia: a game request could not be read', error)
    }
  })
}
