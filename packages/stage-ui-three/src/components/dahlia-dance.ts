// Dahlia: dancing to music. AIRI's Beat Sync module (Settings > Modules > Beat Sync) hears the beats of what
// plays on the PC; her 2D avatar nods to them, her 3D avatar did nothing. Now, when the beats are steady for a
// few seconds, her 3D avatar starts one of the dances of her animation library, played faster or slower so it
// keeps up with the music's tempo, changes to another dance every few bars, and returns to standing when the
// music stops. The idea is the motion choreography of dasilva333/airi, which cuts dances into key poses and
// warps them onto the beat grid of a song it analysed beforehand; hers follows the live beats and fits the
// tempo only. components/DahliaAnimations.vue dances. This file is Dahlia's (AIRI has no such file).

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

export interface DahliaDanceState {
  dancing: boolean
  /** The music's tempo, when it is steady. */
  bpm?: number
  /** How fast a dance is played to keep up: 1 at the native tempo. */
  speed: number
  /** Counts up with every dance she should change to. */
  round: number
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

  /** A beat was heard at this time (milliseconds). */
  beat(at: number) {
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
    if (this.state.dancing) {
      this.dancingBeats++
      const round = this.state.round + (this.dancingBeats % DANCE_CHANGE_BEATS === 0 ? 1 : 0)
      this.state = { dancing: true, bpm, speed: danceSpeed(bpm), round }
    }
    else if (this.steady >= DANCE_START_BEATS) {
      this.dancingBeats = 0
      this.state = { dancing: true, bpm, speed: danceSpeed(bpm), round: this.state.round + 1 }
    }
  }

  /** The state at this time: the music has stopped when no beat came for a while. */
  at(now: number): DahliaDanceState {
    const last = this.beats.at(-1)
    if (this.state.dancing && (last === undefined || now - last > DANCE_STOP_MS)) {
      this.beats = []
      this.steady = 0
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
