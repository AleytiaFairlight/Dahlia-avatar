import { describe, expect, it } from 'vitest'

import { classifyThinking, DahliaThinkingFillers, FILLER_FIRST_MS, FILLER_LATER_MS } from './dahlia-thinking-fillers'

function fillers(options: { enabled?: boolean, speaks?: boolean } = {}) {
  let clock = 0
  let timers: Array<{ at: number, run: () => void, id: number }> = []
  let nextId = 1
  const spoken: Array<{ at: number, turn: string, phrase: string }> = []
  const instance = new DahliaThinkingFillers({
    speak: (turn, phrase) => {
      spoken.push({ at: clock, turn, phrase })
      return options.speaks !== false
    },
    enabled: () => options.enabled !== false,
    now: () => clock,
    setTimer: (run, ms) => {
      const id = nextId++
      timers.push({ at: clock + ms, run, id })
      return id
    },
    clearTimer: (id) => {
      timers = timers.filter(timer => timer.id !== id)
    },
    random: () => 0,
  })
  /** Lets time pass, running the timers that come due. */
  const pass = (ms: number) => {
    const until = clock + ms
    for (;;) {
      const due = timers.filter(timer => timer.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!due)
        break
      timers = timers.filter(timer => timer !== due)
      clock = due.at
      due.run()
    }
    clock = until
  }
  return { instance, spoken, pass }
}

describe('dahlia thinking fillers', () => {
  it('says a phrase that fits the question when the answer is slow to start, and more when it takes much longer', () => {
    const { instance, spoken, pass } = fillers()
    instance.turnStarted('a', 'Can you explain why my code has this bug?')
    pass(FILLER_FIRST_MS - 1)
    expect(spoken).toEqual([])
    pass(1)
    expect(spoken).toEqual([{ at: FILLER_FIRST_MS, turn: 'a', phrase: 'Hmm, let me work that out.' }])

    pass(FILLER_LATER_MS[0] + FILLER_LATER_MS[1] + 60_000)
    expect(spoken.map(entry => entry.phrase)).toEqual(['Hmm, let me work that out.', 'Still thinking, one moment.', 'Almost there.'])
    expect(spoken[2].at).toBe(FILLER_FIRST_MS + FILLER_LATER_MS[0] + FILLER_LATER_MS[1])
  })

  it('says nothing when the answer starts in time, the turn ends, or it is turned off', () => {
    const quick = fillers()
    quick.instance.turnStarted('a', 'Hi')
    quick.pass(2000)
    quick.instance.answerStarted('a')
    quick.pass(60_000)
    expect(quick.spoken).toEqual([])

    quick.instance.turnStarted('b', 'Hi')
    quick.pass(1000)
    quick.instance.turnEnded('b')
    quick.pass(60_000)
    expect(quick.spoken).toEqual([])

    const off = fillers({ enabled: false })
    off.instance.turnStarted('a', 'Hi')
    off.pass(60_000)
    expect(off.spoken).toEqual([])

    const mute = fillers({ speaks: false })
    mute.instance.turnStarted('a', 'Hi')
    mute.pass(60_000)
    expect(mute.spoken, 'a turn without speech is asked once').toHaveLength(1)
  })

  it('arms nothing while answers usually start fast, and again when they slow down', () => {
    const { instance, spoken, pass } = fillers()
    for (const turn of ['a', 'b', 'c']) {
      instance.turnStarted(turn, 'Hi')
      pass(600)
      instance.answerStarted(turn)
    }
    expect(instance.usualWait()).toBe(600)
    instance.turnStarted('d', 'Hi')
    pass(9000)
    expect(spoken, 'fast answers: not armed, even though this one was slow').toEqual([])
    instance.answerStarted('d')

    for (const turn of ['e', 'f']) {
      instance.turnStarted(turn, 'Hi')
      pass(8000)
      instance.answerStarted(turn)
    }
    expect(instance.usualWait()).toBe(8000)
    instance.turnStarted('g', 'Hi')
    pass(FILLER_FIRST_MS)
    expect(spoken.map(entry => entry.turn)).toEqual(['g'])
  })

  it('tells the kind of question from its words', () => {
    expect(classifyThinking('Do you remember what we did yesterday?')).toBe('memory')
    expect(classifyThinking('I feel so tired and sad today')).toBe('emotional')
    expect(classifyThinking('Which one should I choose?')).toBe('uncertain')
    expect(classifyThinking('How do I fix this error in my code?')).toBe('analytical')
    expect(classifyThinking('Good morning!')).toBe('generic')
    expect(classifyThinking('The show was great'), '"how" inside "show" is not a question').toBe('generic')
  })
})
