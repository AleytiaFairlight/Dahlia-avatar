// Dahlia: Dahlia watching Aleytia play a game on the PC, to learn it. While the game window is in front, it is
// captured every moment; each of Aleytia's own clicks and drags on it becomes a sample (the screen before it,
// where it landed, the screen after it) that goes to her server (/api/v1/dahlia/game/learn), which keeps them
// and describes some as they come. When watching ends, the server turns what she saw into notes for the game.
// This file is Dahlia's (AIRI has no such file); the desktop app runs it with its window helper
// (src/renderer/dahlia-game-watch.ts).

import { errorMessageFrom } from '@moeru/std'

/** One of Aleytia's clicks or drags: positions 0-1000 across the window, the press time (ms) and its length. */
export interface DahliaWatchGesture {
  x1: number
  y1: number
  x2: number
  y2: number
  at: number
  ms: number
}

export type DahliaWatchAction
  = | { type: 'tap', x: number, y: number }
    | { type: 'swipe', x1: number, y1: number, x2: number, y2: number, ms: number }

export interface DahliaWatchSample {
  game: string
  session: string
  at: number
  action: DahliaWatchAction
  /** The screen just before the press, as an image data URL. */
  before: string
  /** The screen a moment after the release, when one was captured in time. */
  after?: string
}

export interface DahliaGameWatchWindow {
  find: (title: string) => Promise<{ hwnd: number, title: string }>
  /** The window as an image data URL while it is in front; undefined while another window is. */
  peek: (hwnd: number, maxHeight: number) => Promise<string | undefined>
  /** Her clicks and drags on the window since the last call. */
  events: (hwnd: number) => Promise<DahliaWatchGesture[]>
  /** Stops listening to the mouse. */
  stop: () => Promise<void>
}

export interface DahliaGameWatchSession {
  game: string
  /** The game window's title, such as "DarkWar". */
  windowTitle: string
  minutes?: number
}

export interface DahliaGameWatchState {
  running: boolean
  game?: string
  session?: string
  windowTitle?: string
  endsAt?: number
  /** Samples sent to her server. */
  samples: number
  /** Clicks that didn't become a sample (no picture before them, or the upload failed). */
  missed: number
  log: string[]
  /** Why watching ended, and what she learned. */
  ended?: string
}

export interface DahliaGameWatcherOptions {
  window: DahliaGameWatchWindow
  upload: (sample: DahliaWatchSample) => Promise<void>
  /** Tells her server the session is over; its answer (what she learned) is shown. */
  end: (game: string, session: string) => Promise<string | undefined>
  onState?: (state: DahliaGameWatchState) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** The pictures' height: enough to cut buttons and read text from later. */
export const WATCH_CAPTURE_HEIGHT = 1024
/** How often the window is captured and the clicks collected. */
export const WATCH_TICK_MS = 700
/** The screen "after" a click is the first one captured this long after the release: the game has answered. */
export const WATCH_AFTER_MS = 1_200
/** A click with no "after" picture by then is sent without one (she switched away, or the game stalled). */
const AFTER_GIVE_UP_MS = 6_000
/** A "before" picture older than this doesn't show what she clicked on. */
const BEFORE_MAX_AGE_MS = 3_000
/** Drags shorter than this (0-1000 across the window) are clicks. */
const DRAG_DISTANCE = 15
const DEFAULT_MINUTES = 60
const MAX_MINUTES = 240
const MAX_LOG = 12
const MAX_FAILURES = 5
const KEPT_FRAMES = 8

interface Frame { image: string, start: number, end: number }
interface Pending { gesture: DahliaWatchGesture, before: string }

export function watchAction(gesture: DahliaWatchGesture): DahliaWatchAction {
  const distance = Math.hypot(gesture.x2 - gesture.x1, gesture.y2 - gesture.y1)
  return distance < DRAG_DISTANCE
    ? { type: 'tap', x: gesture.x1, y: gesture.y1 }
    : { type: 'swipe', x1: gesture.x1, y1: gesture.y1, x2: gesture.x2, y2: gesture.y2, ms: gesture.ms }
}

export function describeWatchAction(action: DahliaWatchAction) {
  return action.type === 'tap'
    ? `click (${action.x}, ${action.y})`
    : `drag (${action.x1}, ${action.y1}) to (${action.x2}, ${action.y2})`
}

/** A session name that sorts by time: 20261102-153012-a1b2. */
export function watchSessionId(date: Date, random = Math.random()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${stamp}-${Math.floor(random * 0x10000).toString(16).padStart(4, '0')}`
}

export class DahliaGameWatcher {
  private run = 0
  private stopReason?: string
  state: DahliaGameWatchState = { running: false, samples: 0, missed: 0, log: [] }

  constructor(private readonly options: DahliaGameWatcherOptions) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  private sleep(ms: number) {
    return this.options.sleep?.(ms) ?? new Promise<void>(resolve => setTimeout(resolve, ms))
  }

  private update(state: Partial<DahliaGameWatchState>) {
    this.state = { ...this.state, ...state }
    this.options.onState?.(this.state)
  }

  private logLine(line: string) {
    this.update({ log: [...this.state.log, line].slice(-MAX_LOG) })
  }

  /** Starts watching, or gives the running session a new time. Resolves when watching ends. */
  start(session: DahliaGameWatchSession): Promise<void> {
    const minutes = Math.min(Math.max(Math.round(session.minutes || DEFAULT_MINUTES), 1), MAX_MINUTES)
    const endsAt = this.now() + minutes * 60_000
    if (this.state.running) {
      this.update({ endsAt })
      return Promise.resolve()
    }

    const run = ++this.run
    const id = watchSessionId(new Date(this.now()))
    this.update({ running: true, game: session.game, session: id, windowTitle: session.windowTitle, endsAt, samples: 0, missed: 0, log: [], ended: undefined })
    return this.watch(run, session.game, id, session.windowTitle)
  }

  stop(reason = 'Stopped.') {
    if (!this.state.running)
      return
    this.stopReason = reason
    this.update({ endsAt: 0 })
  }

  private async watch(run: number, game: string, session: string, windowTitle: string) {
    const live = () => this.run === run
    let hwnd: number
    try {
      const found = await this.options.window.find(windowTitle)
      hwnd = found.hwnd
      this.logLine(`Watching the window "${found.title}". Play as usual; I learn from your clicks.`)
    }
    catch (error) {
      this.update({ running: false, ended: errorMessageFrom(error) ?? 'The game window wasn\'t found.' })
      return
    }

    const frames: Frame[] = []
    const pending: Pending[] = []
    let failures = 0
    let reason = 'Time is up.'

    const send = async (item: Pending, after: string | undefined) => {
      const action = watchAction(item.gesture)
      try {
        await this.options.upload({ game, session, at: item.gesture.at, action, before: item.before, after })
        this.update({ samples: this.state.samples + 1 })
        this.logLine(`Saw ${describeWatchAction(action)}.`)
      }
      catch (error) {
        this.update({ missed: this.state.missed + 1 })
        this.logLine(`Couldn't keep a click: ${errorMessageFrom(error) ?? 'the upload failed'}.`)
      }
    }

    while (live()) {
      if (this.now() >= (this.state.endsAt ?? 0)) {
        reason = this.stopReason ?? reason
        break
      }

      try {
        const start = this.now()
        const image = await this.options.window.peek(hwnd, WATCH_CAPTURE_HEIGHT)
        if (image) {
          frames.push({ image, start, end: this.now() })
          frames.splice(0, Math.max(0, frames.length - KEPT_FRAMES))
        }

        for (const gesture of await this.options.window.events(hwnd)) {
          // The newest picture finished before the press shows what she pressed on.
          const before = frames.filter(frame => frame.end <= gesture.at && gesture.at - frame.end <= BEFORE_MAX_AGE_MS).at(-1)
          if (before)
            pending.push({ gesture, before: before.image })
          else
            this.update({ missed: this.state.missed + 1 })
        }

        while (pending.length > 0) {
          const item = pending[0]
          const released = item.gesture.at + item.gesture.ms
          const after = frames.find(frame => frame.start >= released + WATCH_AFTER_MS)
          if (!after && this.now() - released < AFTER_GIVE_UP_MS)
            break
          pending.shift()
          await send(item, after?.image)
        }
        failures = 0
      }
      catch (error) {
        failures++
        const message = errorMessageFrom(error) ?? 'The game window stopped answering.'
        this.logLine(`Problem: ${message}`)
        if (failures >= MAX_FAILURES) {
          reason = message
          break
        }
      }

      await this.sleep(WATCH_TICK_MS)
    }

    // Clicks still waiting for their "after" picture go without one.
    for (const item of pending.splice(0))
      await send(item, undefined)
    await this.options.window.stop().catch(() => undefined)
    if (!live())
      return

    let learned: string | undefined
    try {
      learned = this.state.samples > 0 ? await this.options.end(game, session) : undefined
    }
    catch (error) {
      learned = `Her server couldn't finish the session: ${errorMessageFrom(error) ?? 'unknown error'}.`
    }
    this.stopReason = undefined
    this.update({ running: false, ended: [reason, `${this.state.samples} clicks kept.`, learned].filter(Boolean).join(' ') })
  }
}
