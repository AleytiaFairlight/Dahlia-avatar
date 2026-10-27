// Dahlia: Dahlia playing a game in a window on the PC. Each step captures the game window, asks her server
// for one move (/api/v1/dahlia/game/step, which keeps her notes about the game) and makes it, until the time
// is up, she says she's done, or she is stopped. This file is Dahlia's (AIRI has no such file); the desktop
// app runs it with its window helper (src/renderer/dahlia-game-player.ts).

import { errorMessageFrom } from '@moeru/std'

export interface DahliaGameWindow {
  find: (title: string) => Promise<{ hwnd: number, title: string }>
  /** A screenshot of the window as an image data URL. It must see GPU-drawn games (Windows Graphics Capture). */
  capture: (hwnd: number, maxHeight: number) => Promise<{ image: string }>
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
}

export interface DahliaGameRequest {
  game: string
  goal: string
  image: string
  history: { action: string, thought: string }[]
}

export interface DahliaGameSession {
  game: string
  /** Text in the game window's title, such as "Dark War". */
  windowTitle: string
  goal: string
  minutes: number
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
    const minutes = Math.min(Math.max(session.minutes || 30, 1), 240)
    this.session = { ...session, minutes }
    const endsAt = this.now() + minutes * 60_000
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
      if (this.now() >= (this.state.endsAt ?? 0)) {
        this.update({ running: false, ended: 'Time is up.' })
        return
      }

      let step: DahliaGameStep
      try {
        const { image } = await this.options.window.capture(hwnd, GAME_CAPTURE_HEIGHT)
        if (!live())
          return
        step = await this.options.step({
          game: this.session!.game,
          goal: this.session!.goal,
          image,
          history: history.slice(-MAX_HISTORY),
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
      this.logLine(`${description}: ${step.thought}${step.note ? ` (noted: ${step.note})` : ''}`)

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
