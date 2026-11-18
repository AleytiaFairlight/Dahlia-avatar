// Dahlia: PC awareness. While a person has it on (or while she watches their screen), the desktop app tells her
// server which window is in front, how long the keyboard and mouse have been still, which apps were used in the
// last hour and today, how busy the PC is (processor, memory, graphics card), the sound volume and the PC's clock;
// her server keeps the newest report in her prompt for that person's chats
// (POST /api/v1/dahlia/pc/state, Gateway/PcAwareness.cs), so she knows what they are doing without being told.
// Nothing is kept: her server forgets a report after 3 minutes. The desktop app samples (renderer/
// dahlia-pc-awareness.ts); this file is the loop. The idea comes from the OS sensors of dasilva333/airi (active
// window, idle time, app history, system load in the prompt); the code is Dahlia's, on her own window helper.
// This file is Dahlia's (AIRI has no such file).

import { errorMessageFrom } from '@moeru/std'

export interface DahliaPcSample {
  /** The program of the window in front, and its title; "" where the PC can't tell. */
  app: string
  title: string
  /** One of Dahlia's own windows is in front. */
  own?: boolean
  /** Seconds since the keyboard or mouse was last used. */
  idleSeconds: number
  /** Processor and memory in use, 0-100. */
  cpu?: number
  memory?: number
  /** The graphics card's busiest engine and the sound volume, 0-100, and whether the sound is muted. */
  gpu?: number
  volume?: number
  muted?: boolean
}

export interface DahliaPcReport {
  app: string
  title: string
  idleSeconds: number
  cpu?: number
  memory?: number
  gpu?: number
  volume?: number
  muted?: boolean
  recent: Array<{ app: string, minutes: number }>
  /** The apps in front since midnight on this PC, the longest first. */
  today: Array<{ app: string, minutes: number }>
  /** This PC's clock with its UTC offset, such as 2026-11-18T23:40:00+01:00, and its time zone. */
  localTime: string
  timeZone?: string
}

/** The time with this PC's UTC offset, such as 2026-11-18T23:40:05+01:00. */
export function localTimeOf(at: number) {
  const date = new Date(at)
  const offset = -date.getTimezoneOffset()
  const two = (value: number) => String(Math.floor(Math.abs(value))).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
    + `${offset < 0 ? '-' : '+'}${two(offset / 60)}:${two(offset % 60)}`
}

function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  }
  catch {
    return undefined
  }
}

export interface DahliaPcAwarenessState {
  running: boolean
  app?: string
  title?: string
  idleSeconds?: number
  lastReportAt?: number
  error?: string
}

export interface DahliaPcAwarenessOptions {
  sample: () => Promise<DahliaPcSample>
  report: (report: DahliaPcReport) => Promise<void>
  /** Tells her server to forget the last report. */
  stop: () => Promise<void>
  onState?: (state: DahliaPcAwarenessState) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** "on" while the person lets their PC tell her what they are doing; shared between the windows. */
export const DAHLIA_PC_AWARENESS_KEY = 'dahlia/pc-awareness'
export const DAHLIA_PC_AWARENESS_STATUS_KEY = 'dahlia/pc-awareness-status'

export const PC_SAMPLE_MS = 10_000
/** A report goes out when something changed, and at least this often, so her server's copy stays fresh. */
export const PC_REPORT_MS = 60_000
/** Still this long counts as away; crossing it either way is worth a report. */
export const PC_AWAY_SECONDS = 120
export const PC_HISTORY_MS = 60 * 60_000
export const PC_RECENT_APPS = 5
/** After this many failures in a row it samples slowly until one works again. */
export const PC_MAX_FAILURES = 5
export const PC_SLOW_MS = 60_000

export class DahliaPcAwareness {
  state: DahliaPcAwarenessState = { running: false }
  private run = 0
  /** Which app was in front when, newest last. */
  private history: Array<{ app: string, from: number, to: number }> = []
  /** How long each app was in front today, in milliseconds; only in memory, so a restart starts the day again. */
  private today = { day: '', apps: new Map<string, number>() }

  constructor(private readonly options: DahliaPcAwarenessOptions) {}

  private update(patch: Partial<DahliaPcAwarenessState>) {
    this.state = { ...this.state, ...patch }
    this.options.onState?.(this.state)
  }

  private used(app: string, from: number, to: number) {
    const last = this.history.at(-1)
    if (last && last.app === app && from - last.to <= PC_SAMPLE_MS * 2)
      last.to = to
    else
      this.history.push({ app, from, to })
    this.history = this.history.filter(entry => to - entry.to < PC_HISTORY_MS)

    const day = new Date(to).toDateString()
    if (this.today.day !== day)
      this.today = { day, apps: new Map() }
    this.today.apps.set(app, (this.today.apps.get(app) ?? 0) + to - from)
  }

  /** The apps in front today, the longest first, in whole minutes. */
  todayApps(now: number) {
    if (this.today.day !== new Date(now).toDateString())
      return []
    return [...this.today.apps]
      .map(([app, ms]) => ({ app, minutes: Math.round(ms / 60_000) }))
      .filter(entry => entry.minutes >= 1)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, PC_RECENT_APPS)
  }

  /** The apps in front in the last hour, the longest first, in whole minutes. */
  recent(now: number) {
    const total = new Map<string, number>()
    for (const entry of this.history) {
      const from = Math.max(entry.from, now - PC_HISTORY_MS)
      if (entry.to > from)
        total.set(entry.app, (total.get(entry.app) ?? 0) + entry.to - from)
    }
    return [...total]
      .map(([app, ms]) => ({ app, minutes: Math.round(ms / 60_000) }))
      .filter(entry => entry.minutes >= 1)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, PC_RECENT_APPS)
  }

  async start() {
    if (this.state.running)
      return
    const now = this.options.now ?? Date.now
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
    const run = ++this.run
    this.update({ running: true, error: undefined })

    let reported: { app: string, title: string, away: boolean, muted?: boolean, at: number } | undefined
    let front = { app: '', title: '' }
    let sampledAt: number | undefined
    let failures = 0
    while (run === this.run) {
      try {
        const sample = await this.options.sample()
        if (run !== this.run)
          return
        const at = now()
        // Her own window in front means the person is talking to her: what they were doing stays the app before.
        if (!sample.own && (sample.app || sample.title))
          front = { app: sample.app, title: sample.title }
        if (!sample.own && sample.app && sample.idleSeconds < PC_AWAY_SECONDS && sampledAt !== undefined)
          this.used(sample.app, sampledAt, at)
        sampledAt = at

        const away = sample.idleSeconds >= PC_AWAY_SECONDS
        const muted = sample.muted === true || sample.volume === 0
        const changed = !reported || reported.app !== front.app || reported.title !== front.title || reported.away !== away || reported.muted !== muted
        if (changed || at - reported!.at >= PC_REPORT_MS) {
          await this.options.report({
            ...front,
            idleSeconds: Math.round(sample.idleSeconds),
            cpu: sample.cpu,
            memory: sample.memory,
            gpu: sample.gpu,
            volume: sample.volume,
            muted: sample.muted,
            recent: this.recent(at),
            today: this.todayApps(at),
            localTime: localTimeOf(at),
            timeZone: timeZone(),
          })
          if (run !== this.run)
            return
          reported = { ...front, away, muted, at }
          this.update({ ...front, idleSeconds: Math.round(sample.idleSeconds), lastReportAt: at, error: undefined })
        }
        failures = 0
      }
      catch (error) {
        if (run !== this.run)
          return
        failures++
        this.update({ error: errorMessageFrom(error) ?? String(error) })
      }
      await sleep(failures >= PC_MAX_FAILURES ? PC_SLOW_MS : PC_SAMPLE_MS)
    }
  }

  /** Stops reporting; her server forgets the last report. */
  async stop() {
    if (!this.state.running)
      return
    this.run++
    this.update({ running: false })
    try {
      await this.options.stop()
    }
    catch {
      // Her server forgets an old report by itself.
    }
  }
}
