// Dahlia: speaking first. Until now she only ever answered. At a quiet moment she may now say something on her own:
// the desktop app gives her the same kind of notification an avatar touch gives ("you may react, or stay quiet"),
// and her server's prompt already tells her the time, what the person is doing on the PC, what is on the screen
// when she watches it, and what she remembers; so what she says, if anything, comes from that. She decides
// whether it is worth saying. This file decides only when she is asked: not too often, not at night, not while
// the person is away or the two are talking, and not more than a few times a day. The idea is the "heartbeats"
// of dasilva333/airi (docs/design-proactivity-heartbeats-engine.md: a timer, hours, a presence gate, and a model
// that may stay silent); the code is Dahlia's, on the app's own notification path. This file is Dahlia's.

export interface DahliaProactiveSettings {
  enabled: boolean
  /** At least this long between two moments she is asked. */
  everyMinutes: number
  /** The hours of the day she may speak first in, local time: from (inclusive) to (exclusive). */
  fromHour: number
  toHour: number
  /** At most this many times a day. */
  perDay: number
}

export const DAHLIA_PROACTIVE_KEY = 'dahlia/speak-first'
export const DAHLIA_PROACTIVE_DEFAULTS: DahliaProactiveSettings = { enabled: true, everyMinutes: 45, fromHour: 9, toHour: 23, perDay: 8 }
/** Still at the keyboard or mouse within this long counts as there. */
export const PROACTIVE_AWAY_SECONDS = 300
/** After the last thing either of them said, she waits at least this long. */
export const PROACTIVE_QUIET_MS = 10 * 60_000
/** After the app started, she waits this long before her first word. */
export const PROACTIVE_WARMUP_MS = 5 * 60_000

export function readDahliaProactiveSettings(raw: string | null | undefined): DahliaProactiveSettings {
  let saved: Partial<DahliaProactiveSettings> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : undefined
    if (parsed && typeof parsed === 'object')
      saved = parsed as Partial<DahliaProactiveSettings>
  }
  catch {
    // A broken setting counts as none.
  }
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DAHLIA_PROACTIVE_DEFAULTS.enabled,
    everyMinutes: number(saved.everyMinutes, DAHLIA_PROACTIVE_DEFAULTS.everyMinutes, 10, 600),
    fromHour: number(saved.fromHour, DAHLIA_PROACTIVE_DEFAULTS.fromHour, 0, 23),
    toHour: number(saved.toHour, DAHLIA_PROACTIVE_DEFAULTS.toHour, 1, 24),
    perDay: number(saved.perDay, DAHLIA_PROACTIVE_DEFAULTS.perDay, 1, 48),
  }
}

export type DahliaProactiveHold = 'off' | 'warming-up' | 'night' | 'too-soon' | 'talking' | 'away' | 'busy' | 'enough-today'

export interface DahliaProactiveMoment {
  now: number
  /** When the app started, when either of them last said something, and when she was last asked. */
  startedAt: number
  lastTurnAt?: number
  lastAskedAt?: number
  /** The times she was asked, to count today's. */
  asked: number[]
  /** Seconds since the keyboard or mouse was used; undefined where the app can't tell (it then counts as there). */
  idleSeconds?: number
  /** She is answering or speaking, or the person is typing to her. */
  busy: boolean
}

function hourOf(time: number) {
  return new Date(time).getHours()
}

function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

/** Why she isn't asked now, or undefined when this is a moment to ask her. */
export function dahliaProactiveHold(settings: DahliaProactiveSettings, moment: DahliaProactiveMoment): DahliaProactiveHold | undefined {
  if (!settings.enabled)
    return 'off'
  if (moment.now - moment.startedAt < PROACTIVE_WARMUP_MS)
    return 'warming-up'
  const hour = hourOf(moment.now)
  // "From 22 to 6" runs over midnight.
  const inHours = settings.fromHour < settings.toHour ? hour >= settings.fromHour && hour < settings.toHour : hour >= settings.fromHour || hour < settings.toHour
  if (!inHours)
    return 'night'
  if (moment.busy)
    return 'busy'
  if (moment.lastTurnAt !== undefined && moment.now - moment.lastTurnAt < PROACTIVE_QUIET_MS)
    return 'talking'
  if (moment.lastAskedAt !== undefined && moment.now - moment.lastAskedAt < settings.everyMinutes * 60_000)
    return 'too-soon'
  if (moment.idleSeconds !== undefined && moment.idleSeconds >= PROACTIVE_AWAY_SECONDS)
    return 'away'
  if (moment.asked.filter(at => sameDay(at, moment.now)).length >= settings.perDay)
    return 'enough-today'
  return undefined
}

/** What she is told at such a moment. Her server's prompt has the rest: the time, the PC, the screen, her memories. */
export function dahliaProactiveNotice(moment: { now: number, lastTurnAt?: number }) {
  const quiet = moment.lastTurnAt === undefined ? undefined : Math.round((moment.now - moment.lastTurnAt) / 60_000)
  const since = quiet === undefined
    ? 'You haven\'t talked yet since the app started.'
    : quiet >= 120 ? `You last talked ${Math.round(quiet / 60)} hours ago.` : `You last talked ${quiet} minutes ago.`
  return {
    headline: 'A quiet moment: you may say something first.',
    note: `${since} Nobody asked you anything. If there is something worth saying now, say it in one or two short sentences: `
      + 'something about what they are doing on their PC or what is on their screen (your prompt has it when you know), something you remember that fits the moment, '
      + 'a thing you promised to bring up, or a kind word at the right time. Don\'t ask "how can I help", don\'t repeat what you said the last time, '
      + 'and don\'t use tools for this. Most of the time nothing is worth interrupting for: then stay quiet: say nothing at all (your no-response tool, when you have it).',
  }
}
