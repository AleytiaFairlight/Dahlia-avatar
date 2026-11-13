import { describe, expect, it } from 'vitest'

import { DahliaDanceTracker, DANCE_CHANGE_BEATS, DANCE_STOP_MS, danceSpeed } from './dahlia-dance'

function play(tracker: DahliaDanceTracker, bpm: number, beats: number, from = 0, jitter: (index: number) => number = () => 0) {
  let at = from
  for (let i = 0; i < beats; i++) {
    tracker.beat(at + jitter(i))
    at += 60_000 / bpm
  }
  return at - 60_000 / bpm
}

describe('dahlia dance', () => {
  it('starts when the beats are steady, at the music\'s tempo, and stops when it ends', () => {
    const tracker = new DahliaDanceTracker()
    play(tracker, 128, 6)
    expect(tracker.at(3000).dancing, 'a few beats aren\'t music yet').toBe(false)
    const last = play(tracker, 128, 20)
    expect(tracker.at(last)).toMatchObject({ dancing: true, bpm: 128, speed: 1.07, round: 1 })
    expect(tracker.at(last + DANCE_STOP_MS + 1)).toMatchObject({ dancing: false, round: 1 })
  })

  it('doesn\'t dance to scattered sounds, and keeps dancing through a missed beat', () => {
    const noise = new DahliaDanceTracker()
    let at = 0
    for (const gap of [400, 900, 310, 700, 1000, 350, 820, 480, 950, 300, 640, 990, 330, 870])
      noise.beat(at += gap)
    expect(noise.at(at).dancing).toBe(false)

    const tracker = new DahliaDanceTracker()
    const last = play(tracker, 100, 30, 0, index => (index % 7 === 3 ? 25 : 0))
    expect(tracker.at(last).dancing).toBe(true)
    tracker.beat(last + 1200)
    expect(tracker.at(last + 1200).dancing, 'one beat missed').toBe(true)
  })

  it('changes the dance every few bars and fits tempos out of reach at half or double time', () => {
    const tracker = new DahliaDanceTracker()
    const last = play(tracker, 120, DANCE_CHANGE_BEATS + 20)
    expect(tracker.at(last).round).toBe(2)

    expect(danceSpeed(120)).toBe(1)
    expect(danceSpeed(170)).toBe(0.75)
    expect(danceSpeed(70)).toBe(1.17)
    expect(danceSpeed(150)).toBe(1.25)
    expect(danceSpeed(90)).toBe(0.75)
  })
})
