// Dahlia: Dahlia keeps an eye on a person's screen when they ask her to. The PC takes a capture of the screen
// now and then; when it changed, her server notes what it shows (POST /api/v1/dahlia/screen/look) and keeps the
// newest note in her prompt for that person's chats, so she knows what they are doing without a screenshot each
// time. Captures aren't kept anywhere. The desktop app runs it (renderer/dahlia-screen-watch.ts) with its screen
// capture; this file is the loop. This file is Dahlia's (AIRI has no such file).

import { errorMessageFrom } from '@moeru/std'

export interface DahliaScreenWatchState {
  running: boolean
  /** Which screen is watched, as the PC names it. */
  source?: string
  startedAt?: number
  endsAt?: number
  /** Captures her server noted, and captures skipped because the screen hadn't changed. */
  looks: number
  skipped: number
  lastLookAt?: number
  /** Her newest note of the screen. */
  lastSummary?: string
  /** Why it stopped, or the last problem. */
  ended?: string
  error?: string
}

export interface DahliaScreenCapture {
  /** A data URL of the capture. */
  image: string
  /** A small fingerprint of the picture; two equal fingerprints mean the screen didn't change. */
  signature: string
  source: string
}

export interface DahliaScreenWatcherOptions {
  capture: (screen?: number) => Promise<DahliaScreenCapture>
  /** Sends a capture to her server; answers her note, or undefined while her model is busy. */
  look: (capture: DahliaScreenCapture) => Promise<string | undefined>
  /** Tells her server that watching ended. */
  stop: () => Promise<void>
  changed: (before: string | undefined, after: string) => boolean
  onState?: (state: DahliaScreenWatchState) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** The watcher's state, for Settings > Modules > Vision (which may be in another window). */
export const DAHLIA_SCREEN_WATCH_STATUS_KEY = 'dahlia/screen-watch-status'
/** A command from that page to the window that watches: {op: 'start' | 'stop', at}. */
export const DAHLIA_SCREEN_WATCH_COMMAND_KEY = 'dahlia/screen-watch-command'

export const SCREEN_WATCH_DEFAULT_SECONDS = 60
export const SCREEN_WATCH_MIN_SECONDS = 20
export const SCREEN_WATCH_DEFAULT_MINUTES = 30
export const SCREEN_WATCH_MAX_MINUTES = 240
/** An unchanged screen is still noted again after this long, so her note never gets older than her server keeps it. */
export const SCREEN_WATCH_REFRESH_MS = 4 * 60_000
/** Watching ends after this many failures in a row. */
export const SCREEN_WATCH_MAX_FAILURES = 5

export class DahliaScreenWatcher {
  state: DahliaScreenWatchState = { running: false, looks: 0, skipped: 0 }
  private run = 0

  constructor(private readonly options: DahliaScreenWatcherOptions) {}

  private update(patch: Partial<DahliaScreenWatchState>) {
    this.state = { ...this.state, ...patch }
    this.options.onState?.(this.state)
  }

  /** Starts watching, or restarts with new settings. */
  async start(session: { screen?: number, seconds?: number, minutes?: number } = {}) {
    const now = this.options.now ?? Date.now
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
    const seconds = Math.max(SCREEN_WATCH_MIN_SECONDS, Math.round(Number(session.seconds) || SCREEN_WATCH_DEFAULT_SECONDS))
    const minutes = Math.min(SCREEN_WATCH_MAX_MINUTES, Math.max(1, Math.round(Number(session.minutes) || SCREEN_WATCH_DEFAULT_MINUTES)))
    const run = ++this.run
    const startedAt = now()
    this.update({ running: true, startedAt, endsAt: startedAt + minutes * 60_000, looks: 0, skipped: 0, lastLookAt: undefined, lastSummary: undefined, ended: undefined, error: undefined, source: undefined })

    let lastSignature: string | undefined
    let failures = 0
    while (run === this.run && now() < this.state.endsAt!) {
      try {
        const capture = await this.options.capture(session.screen)
        if (run !== this.run)
          return
        const stale = this.state.lastLookAt === undefined || now() - this.state.lastLookAt >= SCREEN_WATCH_REFRESH_MS
        if (!stale && !this.options.changed(lastSignature, capture.signature)) {
          this.update({ skipped: this.state.skipped + 1, source: capture.source })
        }
        else {
          const summary = await this.options.look(capture)
          if (run !== this.run)
            return
          // Without a note her model was busy with another look; the same capture counts as not seen.
          if (summary !== undefined) {
            lastSignature = capture.signature
            this.update({ looks: this.state.looks + 1, lastLookAt: now(), lastSummary: summary, source: capture.source, error: undefined })
          }
        }
        failures = 0
      }
      catch (error) {
        if (run !== this.run)
          return
        failures++
        this.update({ error: errorMessageFrom(error) ?? String(error) })
        if (failures >= SCREEN_WATCH_MAX_FAILURES) {
          await this.finish(run, `Stopped: ${this.state.error}`)
          return
        }
      }
      await sleep(seconds * 1000)
    }

    if (run === this.run)
      await this.finish(run, 'The time to watch is over.')
  }

  private async finish(run: number, ended: string) {
    if (run !== this.run)
      return
    this.run++
    this.update({ running: false, ended })
    try {
      await this.options.stop()
    }
    catch {
      // Her server forgets an old note by itself.
    }
  }

  /** Stops watching; her server forgets what it saw. */
  async stop(reason = 'Stopped when asked.') {
    if (!this.state.running)
      return
    await this.finish(this.run, reason)
  }
}
