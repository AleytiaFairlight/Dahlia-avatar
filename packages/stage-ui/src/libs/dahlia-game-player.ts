// Dahlia: Dahlia playing a game in a window on the PC. Each step captures the game window, asks her server
// for one move (/api/v1/dahlia/game/step, which keeps her notes about the game) and makes it, until the time
// is up, she says she's done, or she is stopped. This file is Dahlia's (AIRI has no such file); the desktop
// app runs it with its window helper (src/renderer/dahlia-game-player.ts).
// Each capture also brings the words Windows read on the screen (her server taps plain buttons such as FREE
// at once and places labelled taps on their text) and a tiny thumbnail: when a move leaves the screen as it
// was, its history says so, and after a few such moves in a row she goes back to get unstuck.

import { errorMessageFrom } from '@moeru/std'

/** A word Windows' OCR read on the game's screen: its box 0-1000 across the screenshot, and its line. */
export interface DahliaScreenWord {
  t: string
  x: number
  y: number
  w: number
  h: number
  l: number
}

export interface DahliaGameCapture {
  /** The screenshot as an image data URL. */
  image: string
  /** The words on it, when Windows could read them. */
  words?: DahliaScreenWord[]
  /** A 16x16 grayscale thumbnail (base64), to tell whether a move changed the screen. */
  sig?: string
}

export interface DahliaGameWindow {
  find: (title: string) => Promise<{ hwnd: number, title: string }>
  /** A screenshot of the window. It must see GPU-drawn games (Windows Graphics Capture). */
  capture: (hwnd: number, maxHeight: number) => Promise<DahliaGameCapture>
  tap: (hwnd: number, x: number, y: number) => Promise<void>
  swipe: (hwnd: number, x1: number, y1: number, x2: number, y2: number, ms: number) => Promise<void>
  back: (hwnd: number) => Promise<void>
  /** Restores the window and brings it to the front, so the player can watch her play. */
  show?: (hwnd: number) => Promise<void>
}

export type DahliaGameAction
  = | { type: 'tap', x: number, y: number }
    | { type: 'swipe', x1: number, y1: number, x2: number, y2: number }
    | { type: 'back' }
    | { type: 'wait', seconds: number }
    | { type: 'done', summary?: string }

export interface DahliaGameStep {
  thought: string
  action: DahliaGameAction
  note?: string
  /** Her server answered from the screen's text alone, without her model. */
  quick?: boolean
}

export interface DahliaGameRequest {
  game: string
  goal: string
  image: string
  history: { action: string, thought: string }[]
  words?: DahliaScreenWord[]
}

export interface DahliaGameSession {
  game: string
  /** Text in the game window's title, such as "Dark War". */
  windowTitle: string
  goal: string
  /** How long to play, in minutes. Left out (or 0), she plays until she is done or stopped, with no time limit. */
  minutes?: number
}

export interface DahliaGameState {
  running: boolean
  game?: string
  goal?: string
  windowTitle?: string
  endsAt?: number
  steps: number
  /** The latest moves, newest last: what she did and why. */
  log: string[]
  /** Why the last session ended, or what went wrong. */
  ended?: string
}

export interface DahliaGamePlayerOptions {
  window: DahliaGameWindow
  step: (request: DahliaGameRequest) => Promise<DahliaGameStep>
  onState?: (state: DahliaGameState) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** The screenshot's height: enough to read the game's text, small enough for a quick step. */
export const GAME_CAPTURE_HEIGHT = 1024
/** The game animates after a move; the next screenshot waits for it. */
const SETTLE_MS = 1_500
const MAX_LOG = 12
const MAX_HISTORY = 8
const MAX_FAILURES = 3
/** A move's history mark when the next screenshot looked the same; her server reads it too. */
export const UNCHANGED_MARK = '(the screen didn\'t change)'
/** After this many moves in a row that changed nothing, she goes back. */
export const STUCK_MOVES = 3
/** Thumbnail cells (of 256) that must differ, and by how much (0-255), for the screen to count as changed. */
const CHANGED_CELLS = 8
const CELL_DELTA = 20

/** Whether two capture thumbnails show a different screen; true when either is missing. */
export function screenChanged(before?: string, after?: string) {
  if (!before || !after)
    return true
  const a = atob(before)
  const b = atob(after)
  if (a.length !== b.length || a.length === 0)
    return true
  let cells = 0
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) > CELL_DELTA)
      cells++
  }
  return cells >= CHANGED_CELLS
}

/** The words the window helper sent (a JSON string), checked; undefined when there are none. */
export function parseScreenWords(json: unknown): DahliaScreenWord[] | undefined {
  let value: unknown = json
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json)
    }
    catch {
      return undefined
    }
  }
  if (!Array.isArray(value))
    return undefined
  const words = value.filter((word): word is DahliaScreenWord => typeof word?.t === 'string' && word.t.length > 0
    && ['x', 'y', 'w', 'h', 'l'].every(key => Number.isFinite(word[key])))
  return words.length > 0 ? words : undefined
}

export function describeGameAction(action: DahliaGameAction) {
  switch (action.type) {
    case 'tap':
      return `tap (${action.x}, ${action.y})`
    case 'swipe':
      return `swipe (${action.x1}, ${action.y1}) to (${action.x2}, ${action.y2})`
    case 'back':
      return 'back'
    case 'wait':
      return `wait ${action.seconds} s`
    case 'done':
      return 'done'
  }
}

export class DahliaGamePlayer {
  private session?: DahliaGameSession
  private run = 0
  state: DahliaGameState = { running: false, steps: 0, log: [] }

  constructor(private readonly options: DahliaGamePlayerOptions) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  private sleep(ms: number) {
    return this.options.sleep?.(ms) ?? new Promise<void>(resolve => setTimeout(resolve, ms))
  }

  private update(state: Partial<DahliaGameState>) {
    this.state = { ...this.state, ...state }
    this.options.onState?.(this.state)
  }

  private logLine(line: string) {
    this.update({ log: [...this.state.log, line].slice(-MAX_LOG) })
  }

  /** Starts playing, or gives the running session the new goal and time. Resolves when the session ends. */
  start(session: DahliaGameSession): Promise<void> {
    // No minutes means no time limit: she plays until she is done or is stopped.
    const minutes = session.minutes ? Math.max(session.minutes, 1) : undefined
    this.session = { ...session, minutes }
    const endsAt = minutes ? this.now() + minutes * 60_000 : undefined
    if (this.state.running) {
      this.update({ goal: session.goal, endsAt })
      return Promise.resolve()
    }

    const run = ++this.run
    this.update({ running: true, game: session.game, goal: session.goal, windowTitle: session.windowTitle, endsAt, steps: 0, log: [], ended: undefined })
    return this.play(run)
  }

  stop(reason = 'Stopped.') {
    if (!this.state.running)
      return
    this.run++
    this.update({ running: false, ended: reason })
  }

  private async play(run: number) {
    const live = () => this.run === run
    const history: { action: string, thought: string }[] = []
    let failures = 0
    let hwnd: number
    /** The thumbnail of the screen the last tap, swipe or back was made on, until the next capture. */
    let movedOn: string | undefined
    let unchanged = 0

    try {
      const found = await this.options.window.find(this.session!.windowTitle)
      hwnd = found.hwnd
      if (!live())
        return
      this.logLine(`Playing in the window "${found.title}".`)
      await this.options.window.show?.(hwnd)
    }
    catch (error) {
      if (live())
        this.update({ running: false, ended: errorMessageFrom(error) ?? 'The game window wasn\'t found.' })
      return
    }

    while (live()) {
      if (this.state.endsAt !== undefined && this.now() >= this.state.endsAt) {
        this.update({ running: false, ended: 'Time is up.' })
        return
      }

      let step: DahliaGameStep
      let shot: DahliaGameCapture
      try {
        shot = await this.options.window.capture(hwnd, GAME_CAPTURE_HEIGHT)
        if (!live())
          return

        // Did her last move do anything?
        if (movedOn !== undefined && shot.sig) {
          const last = history.at(-1)
          if (!screenChanged(movedOn, shot.sig)) {
            unchanged++
            if (last && !last.action.includes(UNCHANGED_MARK))
              history[history.length - 1] = { ...last, action: `${last.action} ${UNCHANGED_MARK}` }
          }
          else {
            unchanged = 0
          }
        }
        movedOn = undefined

        if (unchanged >= STUCK_MOVES) {
          unchanged = 0
          const thought = `Stuck: ${STUCK_MOVES} moves changed nothing, so I go back.`
          history.push({ action: 'back', thought })
          this.logLine(`back: ${thought}`)
          movedOn = shot.sig
          await this.options.window.back(hwnd)
          await this.sleep(SETTLE_MS)
          continue
        }

        step = await this.options.step({
          game: this.session!.game,
          goal: this.session!.goal,
          image: shot.image,
          history: history.slice(-MAX_HISTORY),
          ...(shot.words ? { words: shot.words } : {}),
        })
        failures = 0
      }
      catch (error) {
        if (!live())
          return
        failures++
        const message = errorMessageFrom(error) ?? 'Something went wrong.'
        this.logLine(`Problem: ${message}`)
        if (failures >= MAX_FAILURES) {
          this.update({ running: false, ended: message })
          return
        }
        await this.sleep(10_000)
        continue
      }

      if (!live())
        return
      const description = describeGameAction(step.action)
      history.push({ action: description, thought: step.thought })
      this.update({ steps: this.state.steps + 1 })
      this.logLine(`${step.quick ? 'quick: ' : ''}${description}: ${step.thought}${step.note ? ` (noted: ${step.note})` : ''}`)
      if (step.action.type === 'tap' || step.action.type === 'swipe' || step.action.type === 'back')
        movedOn = shot.sig

      try {
        switch (step.action.type) {
          case 'tap':
            await this.options.window.tap(hwnd, step.action.x, step.action.y)
            break
          case 'swipe':
            await this.options.window.swipe(hwnd, step.action.x1, step.action.y1, step.action.x2, step.action.y2, 400)
            break
          case 'back':
            await this.options.window.back(hwnd)
            break
          case 'wait':
            await this.sleep(step.action.seconds * 1000)
            break
          case 'done':
            this.update({ running: false, ended: step.action.summary ? `Done: ${step.action.summary}` : 'Done.' })
            return
        }
      }
      catch (error) {
        if (live())
          this.update({ running: false, ended: errorMessageFrom(error) ?? 'The game window stopped answering.' })
        return
      }

      await this.sleep(SETTLE_MS)
    }
  }
}
