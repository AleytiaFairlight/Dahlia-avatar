// Dahlia: dancing to music. AIRI's Beat Sync module (Settings > Modules > Beat Sync) hears the beats of what
// plays on the PC; her 2D avatar nods to them, her 3D avatar did nothing. Now, when the beats are steady for a
// few seconds, her 3D avatar starts one of the dances of her animation library, played faster or slower so it
// keeps up with the music's tempo, changes to another dance every few bars, and returns to standing when the
// music stops. The dance fits the song's energy too, calm, medium or intense, and each dance belongs to one of
// those (after dasilva333/airi's vibe sensor and dance tiers). The fork measures the loudness all the time against
// the song's own range; Beat Sync gives only beats, so here half the energy is the tempo (slow songs are calm, fast
// ones lively) and half is how loud the beat is against the song's quietest and loudest beats of the last half
// minute, so a chorus or a drop turns her livelier within the same song.
// The fork's motion choreography, which cuts dances into key poses and warps them onto the beat grid of a song it
// analysed beforehand, isn't here: hers follows the live beats and fits the tempo only.
// components/DahliaAnimations.vue dances. This file is Dahlia's (AIRI has no such file).

/** "false" when the person turned dancing off (Settings > Dahlia); on otherwise. */
export const DAHLIA_DANCE_KEY = 'dahlia/dance-to-music'
/** The tempo the library's dances are taken to be made for. */
export const DANCE_NATIVE_BPM = 120
/** A dance is played this much slower or faster at most; beyond it, it stops looking like dancing. */
export const DANCE_MIN_SPEED = 0.75
export const DANCE_MAX_SPEED = 1.35
/** Steady beats for this long start a dance; none for this long end it. */
export const DANCE_START_BEATS = 8
export const DANCE_STOP_MS = 3500
/** Another dance after this many beats. */
export const DANCE_CHANGE_BEATS = 64
const MIN_INTERVAL_MS = 60_000 / 210
const MAX_INTERVAL_MS = 60_000 / 55

export type DahliaDanceTier = 'calm' | 'medium' | 'intense'

/** Which of the library's animations dance to calm, medium and intense music (the fork's tiers, by Dahlia's names). */
export const DAHLIA_DANCE_TIERS: Record<DahliaDanceTier, string[]> = {
  calm: ['ladylake', 'arms_swing', 'magic_eye_wink', 'showcase'],
  medium: ['ai_cat_dance', 'arms_up_down_dance', 'kawaii_kaiwai', 'tetris'],
  intense: ['bling_bang', 'crab_dance', 'hito_mania', 'humans_are_just_cylinders'],
}
/** A tier without a dance in the library takes the nearest one that has one. */
const TIER_ORDER: Record<DahliaDanceTier, DahliaDanceTier[]> = {
  calm: ['calm', 'medium', 'intense'],
  medium: ['medium', 'calm', 'intense'],
  intense: ['intense', 'medium', 'calm'],
}
/** A new energy lasting this many beats changes the dance to one of its tier. */
export const DANCE_TIER_BEATS = 8
/** The song's quietest and loudest beats are learned over this long. */
const ENERGY_WINDOW_MS = 30_000
const ENERGY_MIN_BEATS = 12
/** A song whose beats are all about as loud has no range to measure against; its loudness counts as middling. */
const ENERGY_MIN_RANGE_DB = 3
/** Tempos from calm to lively, for the tempo's half of the energy. */
const ENERGY_SLOW_BPM = 80
const ENERGY_FAST_BPM = 140
/** Louder music shows quickly; quieter music settles slowly, so one soft beat doesn't calm her down. */
const ENERGY_ATTACK = 0.5
const ENERGY_RELEASE = 0.15
/** Near a tier's edge she stays in the tier she is in. */
const TIER_MARGIN = 0.06

export interface DahliaDanceState {
  dancing: boolean
  /** The music's tempo, when it is steady. */
  bpm?: number
  /** How fast a dance is played to keep up: 1 at the native tempo. */
  speed: number
  /** Counts up with every dance she should change to. */
  round: number
  /** How lively the song is now, 0-1 against its own range, and its tier. */
  energy?: number
  tier?: DahliaDanceTier
}

/** The tier of an energy; near the edge of the current tier it stays there. */
export function danceTier(energy: number, current?: DahliaDanceTier): DahliaDanceTier {
  const tier: DahliaDanceTier = energy < 1 / 3 ? 'calm' : energy < 2 / 3 ? 'medium' : 'intense'
  if (!current || tier === current)
    return tier
  const [low, high] = { calm: [0, 1 / 3], medium: [1 / 3, 2 / 3], intense: [2 / 3, 1] }[current]
  return energy >= low - TIER_MARGIN && energy < high + TIER_MARGIN ? current : tier
}

/** One of the dances for the tier (the nearest tier that has one), not the last one when there is another. */
export function pickDahliaDance(names: string[], tier: DahliaDanceTier | undefined, last: string | undefined, random: () => number = Math.random) {
  let pool = names
  for (const candidate of tier ? TIER_ORDER[tier] : []) {
    const fitting = names.filter(name => DAHLIA_DANCE_TIERS[candidate].includes(name))
    if (fitting.length > 0) {
      pool = fitting
      break
    }
  }
  const others = pool.filter(name => name !== last)
  const from = others.length > 0 ? others : pool
  return from.length > 0 ? from[Math.min(from.length - 1, Math.floor(random() * from.length))] : undefined
}

/** The tempo's half of the energy: 0 at a slow tempo, 1 at a fast one. */
export function tempoEnergy(bpm: number) {
  return Math.min(1, Math.max(0, (bpm - ENERGY_SLOW_BPM) / (ENERGY_FAST_BPM - ENERGY_SLOW_BPM)))
}

/** How loud each beat was, in decibels, over the last half minute, and the song's energy from them and the tempo. */
class DanceEnergy {
  private levels: Array<{ at: number, db: number }> = []
  energy?: number

  reset() {
    this.levels = []
    this.energy = undefined
  }

  beat(at: number, strength: number, bpm: number) {
    if (!Number.isFinite(strength) || strength <= 0)
      return
    const db = 10 * Math.log10(strength)
    this.levels.push({ at, db })
    this.levels = this.levels.filter(level => at - level.at <= ENERGY_WINDOW_MS)
    if (this.levels.length < ENERGY_MIN_BEATS)
      return

    const sorted = this.levels.map(level => level.db).sort((a, b) => a - b)
    const quiet = sorted[Math.floor((sorted.length - 1) * 0.1)]
    const loud = sorted[Math.floor((sorted.length - 1) * 0.9)]
    const loudness = loud - quiet < ENERGY_MIN_RANGE_DB ? 0.5 : Math.min(1, Math.max(0, (db - quiet) / (loud - quiet)))
    const target = (tempoEnergy(bpm) + loudness) / 2
    const current = this.energy ?? target
    this.energy = current + (target - current) * (target > current ? ENERGY_ATTACK : ENERGY_RELEASE)
  }
}

/** The speed for a tempo. A tempo out of reach is taken at half or double time first. */
export function danceSpeed(bpm: number) {
  let speed = bpm / DANCE_NATIVE_BPM
  if (speed > DANCE_MAX_SPEED)
    speed /= 2
  else if (speed < DANCE_MIN_SPEED)
    speed *= 2
  return Math.min(DANCE_MAX_SPEED, Math.max(DANCE_MIN_SPEED, Math.round(speed * 100) / 100))
}

/** Follows the beats and says whether there is music to dance to. */
export class DahliaDanceTracker {
  private beats: number[] = []
  private steady = 0
  private dancingBeats = 0
  private state: DahliaDanceState = { dancing: false, speed: 1, round: 0 }
  private loudness = new DanceEnergy()
  /** The tier the energy points to now, and for how many beats it has. */
  private heard: { tier?: DahliaDanceTier, beats: number } = { beats: 0 }

  /** A beat was heard at this time (milliseconds), as strong as `strength` (the beat detector's energy) when known. */
  beat(at: number, strength?: number) {
    const last = this.beats.at(-1)
    if (last !== undefined) {
      const interval = at - last
      // Too close is the same beat heard twice; too far is a new start.
      if (interval < MIN_INTERVAL_MS)
        return
      if (interval > MAX_INTERVAL_MS) {
        this.beats = []
        this.steady = 0
      }
    }
    this.beats.push(at)
    if (this.beats.length > 16)
      this.beats.shift()

    const intervals = this.beats.slice(1).map((time, index) => time - this.beats[index])
    if (intervals.length < 4)
      return
    const sorted = [...intervals].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    // Steady: this beat came when the tempo said it would (or a beat was missed: twice as late).
    const latest = intervals.at(-1)!
    const onTime = Math.abs(latest - median) < median * 0.2 || Math.abs(latest - median * 2) < median * 0.2
    this.steady = onTime ? this.steady + 1 : Math.max(0, this.steady - 2)

    const bpm = Math.round(60_000 / median)
    if (strength !== undefined)
      this.loudness.beat(at, strength, bpm)
    const energy = this.loudness.energy
    const heard = energy === undefined ? undefined : danceTier(energy, this.state.tier ?? this.heard.tier)
    this.heard = heard === this.heard.tier ? { tier: heard, beats: this.heard.beats + 1 } : { tier: heard, beats: 1 }
    if (this.state.dancing) {
      this.dancingBeats++
      // A song that turns livelier or calmer for a while gets a dance that fits; the bars change it otherwise.
      const turned = heard !== undefined && heard !== this.state.tier && this.heard.beats >= DANCE_TIER_BEATS
      const round = this.state.round + (turned || this.dancingBeats % DANCE_CHANGE_BEATS === 0 ? 1 : 0)
      if (turned)
        this.dancingBeats = 0
      this.state = { dancing: true, bpm, speed: danceSpeed(bpm), round, energy, tier: turned ? heard : this.state.tier ?? heard }
    }
    else if (this.steady >= DANCE_START_BEATS) {
      this.dancingBeats = 0
      this.state = { dancing: true, bpm, speed: danceSpeed(bpm), round: this.state.round + 1, energy, tier: heard }
    }
  }

  /** The state at this time: the music has stopped when no beat came for a while. */
  at(now: number): DahliaDanceState {
    const last = this.beats.at(-1)
    if (this.state.dancing && (last === undefined || now - last > DANCE_STOP_MS)) {
      this.beats = []
      this.steady = 0
      // The next song learns its own range.
      this.loudness.reset()
      this.heard = { beats: 0 }
      this.state = { dancing: false, speed: 1, round: this.state.round }
    }
    return this.state
  }
}

export function dahliaDanceEnabled() {
  try {
    return localStorage.getItem(DAHLIA_DANCE_KEY) !== 'false'
  }
  catch {
    return true
  }
}
