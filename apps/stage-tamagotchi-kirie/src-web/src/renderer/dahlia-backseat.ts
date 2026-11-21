// Dahlia: backseat gaming. Her point_on_screen tool (dahlia-remote-tools.ts): she points at something in the person's
// game or app with a ghost cursor and a few words (src/main/dahlia-ghost-cursor.ts). The window is captured with the
// words Windows reads on it, her server finds the target on it (by its text, a close X by its shape, or her model,
// the way her game player finds buttons), and the cursor appears there on the screen. Nothing is clicked. After the
// backseat arcade of dasilva333/airi, on the person's own games instead of games in a panel.
// This file is Dahlia's (AIRI has no such file).

import type { DahliaScreenWord } from '@proj-airi/stage-ui/libs/dahlia-game-player'

import { parseScreenWords } from '@proj-airi/stage-ui/libs/dahlia-game-player'

/** How long the cursor stays. */
export const BACKSEAT_POINT_MS = 7000

interface Answer { [field: string]: unknown }

export interface DahliaBackseatDeps {
  /** A window helper request; throws with the helper's error. */
  windowRequest: (request: Record<string, unknown>) => Promise<Answer>
  /** Where the target is on the capture (0-1000), or undefined. */
  locate: (target: string, png: string, words: DahliaScreenWord[] | undefined, game: string) => Promise<{ x: number, y: number, by?: string } | undefined>
  /** Whether one of Dahlia's own windows is in front. */
  ownInFront: () => Promise<boolean>
  /** Shows the ghost cursor at a point on the screen (physical pixels). */
  point: (request: { x: number, y: number, label?: string, ms?: number }) => Promise<{ ok: boolean, error?: string }>
}

export interface DahliaBackseatArgs {
  target: string
  /** A part of the window's title; the window in front without it. */
  window?: string
  label?: string
}

function num(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Points at the target and says what happened, for her. */
export async function pointOnScreen(args: DahliaBackseatArgs, deps: DahliaBackseatDeps): Promise<string> {
  const target = args.target.trim()
  if (!target)
    return 'Say what to point at (target), as it looks or by its text.'

  let hwnd: number
  let title: string
  if (args.window?.trim()) {
    const found = await deps.windowRequest({ op: 'find', title: args.window.trim(), anyApp: true })
    hwnd = num(found.hwnd)
    title = typeof found.title === 'string' ? found.title : args.window.trim()
  }
  else {
    if (await deps.ownInFront())
      return 'Your own chat is in front, not their game. Say which window to point in (window: a part of its title, as PC awareness or screen watching named it).'
    const front = await deps.windowRequest({ op: 'foreground' })
    hwnd = num(front.hwnd)
    title = typeof front.title === 'string' ? front.title : 'the window in front'
  }
  if (!hwnd)
    return 'There is no window to point in.'

  const shot = await deps.windowRequest({ op: 'capture', hwnd, maxHeight: 1024, ocr: true })
  if (typeof shot.png !== 'string')
    return `"${title}" couldn't be captured.`
  const place = await deps.locate(target, shot.png, parseScreenWords(shot.words), '')
  if (!place)
    return `You couldn't find "${target}" in "${title}". Describe it another way, or tell them in words.`

  const frame = await deps.windowRequest({ op: 'frame', hwnd })
  const x = num(frame.left) + place.x / 1000 * num(frame.width)
  const y = num(frame.top) + place.y / 1000 * num(frame.height)
  const shown = await deps.point({ x, y, label: args.label?.trim() || undefined, ms: BACKSEAT_POINT_MS })
  if (!shown.ok)
    return `The pointer couldn't be shown: ${shown.error ?? 'unknown error'}.`
  const how = place.by === 'text' ? ' by its text' : place.by === 'model' ? ' by looking' : ''
  return `Pointed at "${target}" in "${title}"${how} with your ghost cursor for ${BACKSEAT_POINT_MS / 1000} seconds. Nothing was clicked; tell them what to do there.`
}
