// Dahlia: Dahlia keeps an eye on a person's screen when they ask her to. The PC takes a capture of the screen
// now and then; when it changed, her server notes what it shows (POST /api/v1/dahlia/screen/look) and keeps the
// newest note in her prompt for that person's chats, so she knows what they are doing without a screenshot each
// time. Captures aren't kept anywhere. The desktop app runs it (renderer/dahlia-screen-watch.ts) with its screen
// capture; this file is the loop. Not every changed capture goes to her server: dahlia-screen-attention.ts decides
// which ones are worth a look. This file is Dahlia's (AIRI has no such file).

import type { DahliaAttentionReason, DahliaAttentionVerdict, DahliaScreenFrame } from './dahlia-screen-attention'

import { errorMessageFrom } from '@moeru/std'

import { focusRegion, wordSet } from './dahlia-screen-focus'

export interface DahliaScreenWatchState {
  running: boolean
  /** Which screen is watched, as the PC names it. */
  source?: string
  startedAt?: number
  /** When watching ends by itself; not set when it runs until stopped. */
  endsAt?: number
  /** Watching a game: a capture every second. */
  game?: boolean
  /** Seconds between captures. */
  seconds?: number
  /** Captures her server noted, and captures skipped because the screen hadn't changed. */
  looks: number
  skipped: number
  /** Changed captures that weren't worth a look (nothing new, or too soon after the last one). */
  filtered?: number
  /** Why she looked the last time, and why the newest changed capture was left out. */
  lastReason?: DahliaAttentionReason
  lastFiltered?: DahliaAttentionReason
  /** The window in front at her last look. */
  window?: string
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
  /** Reads the capture's text and the window in front; asked only for a capture whose picture changed. */
  read?: () => Promise<DahliaScreenFrame>
  /** A part of the capture at full size (a box in thousandths of the screen), as a data URL. */
  crop?: (box: { x1: number, y1: number, x2: number, y2: number }) => Promise<string | undefined>
}

export interface DahliaSentinelAnswer {
  ready: boolean
  label?: string | null
  nothing?: boolean
  probability?: number
}

/** The decision model must be this sure that something is worth a look, and this sure that nothing is. */
export const SENTINEL_LOOK = 0.6
export const SENTINEL_NOTHING = 0.7
/** At most one question to it in this long. */
export const SENTINEL_GAP_MS = 3000

/** Decides which changed captures are worth a look (DahliaScreenAttention). */
export interface DahliaScreenJudge {
  reset: () => void
  judge: (frame: DahliaScreenFrame, session: { game?: boolean, force?: boolean }) => DahliaAttentionVerdict
  noted: (frame: DahliaScreenFrame) => void
}

export interface DahliaScreenWatcherOptions {
  capture: (screen?: number) => Promise<DahliaScreenCapture>
  /** Sends a capture to her server; answers her note, or undefined while her model is busy. */
  look: (capture: DahliaScreenCapture, seen: DahliaScreenFrame & { focus?: string, focusImage?: string, zone?: string }) => Promise<string | undefined>
  /** Without it every changed capture is looked at. */
  attention?: DahliaScreenJudge
  /**
   * Her server's decision model, which reads what a screen shows by its meaning (POST /screen/judge): the
   * thing worth a look it found (label), or that there is nothing new, with how sure it is. undefined, or
   * ready false, while the model isn't there: the keyword rules decide alone then.
   */
  sentinel?: (frame: DahliaScreenFrame) => Promise<DahliaSentinelAnswer | undefined>
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

/** How often the screen is captured: every 15 seconds, or every second while watching a game. */
export const SCREEN_WATCH_SECONDS = 15
export const SCREEN_WATCH_GAME_SECONDS = 1
export const SCREEN_WATCH_MIN_SECONDS = 1
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
  async start(session: { screen?: number, seconds?: number, minutes?: number, game?: boolean } = {}) {
    const now = this.options.now ?? Date.now
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
    const seconds = Math.max(SCREEN_WATCH_MIN_SECONDS, Math.round(Number(session.seconds) || (session.game ? SCREEN_WATCH_GAME_SECONDS : SCREEN_WATCH_SECONDS)))
    // No limit unless one is asked for: watching runs until it is stopped.
    const minutes = Number(session.minutes) > 0 ? Math.max(1, Math.round(Number(session.minutes))) : undefined
    const run = ++this.run
    const startedAt = now()
    this.update({ running: true, startedAt, endsAt: minutes ? startedAt + minutes * 60_000 : undefined, game: session.game === true, seconds, looks: 0, skipped: 0, filtered: 0, lastReason: undefined, lastFiltered: undefined, window: undefined, lastLookAt: undefined, lastSummary: undefined, ended: undefined, error: undefined, source: undefined })
    this.options.attention?.reset()

    let lastSignature: string | undefined
    let lastWords: Set<string> | undefined
    let lastLabel: string | undefined
    let askedAt = Number.NEGATIVE_INFINITY
    let failures = 0
    while (run === this.run && (this.state.endsAt === undefined || now() < this.state.endsAt)) {
      try {
        const capture = await this.options.capture(session.screen)
        if (run !== this.run)
          return
        const stale = this.state.lastLookAt === undefined || now() - this.state.lastLookAt >= SCREEN_WATCH_REFRESH_MS
        if (!stale && !this.options.changed(lastSignature, capture.signature)) {
          this.update({ skipped: this.state.skipped + 1, source: capture.source })
        }
        else {
          // The text and the window in front cost a moment, so they are read only for a changed capture. A PC
          // that can't read them still watches: the changed picture decides then.
          const frame: DahliaScreenFrame = await capture.read?.().catch((): DahliaScreenFrame => ({})) ?? {}
          if (run !== this.run)
            return
          const ruled: DahliaAttentionVerdict = this.options.attention?.judge(frame, { game: this.state.game, force: stale && this.state.lastLookAt !== undefined })
            ?? { look: true, reason: this.state.lastLookAt === undefined ? 'first' as const : stale ? 'refresh' as const : 'picture' as const }
          // The keyword rules are sure about a first look, an old note, another window, a problem and a watched
          // word. For the rest her server's decision model reads the screen by its meaning: it can find
          // something worth a look where the words didn't change much, and can call a changed screen ordinary.
          let verdict = ruled
          const unsure = ruled.reason === 'quiet' || ruled.reason === 'text' || ruled.reason === 'picture'
          if (unsure && this.options.sentinel && (frame.text || frame.window) && now() - askedAt >= SENTINEL_GAP_MS) {
            askedAt = now()
            const answer = await this.options.sentinel(frame).catch(() => undefined)
            if (run !== this.run)
              return
            if (answer?.ready) {
              const sure = answer.probability ?? 0
              if (answer.label && sure >= SENTINEL_LOOK && answer.label !== lastLabel)
                verdict = { look: true, reason: 'meaning', focus: answer.label }
              else if (answer.nothing && sure >= SENTINEL_NOTHING && ruled.look)
                verdict = { look: false, reason: 'quiet' }
              if (answer.nothing)
                lastLabel = undefined
            }
          }

          if (!verdict.look) {
            this.update({ filtered: (this.state.filtered ?? 0) + 1, lastFiltered: verdict.reason, source: capture.source })
          }
          else {
            // Where to look closely: the whole-screen picture is scaled down, the part that matters goes along at
            // full size. A first look, a refresh and another window are the whole screen anyway.
            const region = verdict.reason === 'first' || verdict.reason === 'refresh' || verdict.reason === 'window'
              ? undefined
              : focusRegion({ words: frame.words, known: lastWords, line: verdict.focus, before: lastSignature, after: capture.signature })
            const focusImage = region ? await capture.crop?.(region.box).catch(() => undefined) : undefined
            if (run !== this.run)
              return
            const summary = await this.options.look(capture, { ...frame, focus: verdict.focus, focusImage, zone: focusImage ? region?.zone : undefined })
            if (run !== this.run)
              return
            // Without a note her model was busy with another look; the same capture counts as not seen.
            if (summary !== undefined) {
              lastSignature = capture.signature
              lastWords = frame.words ? wordSet(frame.words) : undefined
              if (verdict.reason === 'meaning')
                lastLabel = verdict.focus
              this.options.attention?.noted(frame)
              this.update({ looks: this.state.looks + 1, lastLookAt: now(), lastSummary: summary, lastReason: verdict.reason, window: frame.window, source: capture.source, error: undefined })
            }
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
