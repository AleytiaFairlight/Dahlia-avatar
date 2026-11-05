// Dahlia: tests for dahlia-game-player.ts, Dahlia playing a game in a window.
import type { DahliaGameStep, DahliaGameWindow } from './dahlia-game-player'

import { describe, expect, it, vi } from 'vitest'

import { DahliaGamePlayer, describeGameAction, parseScreenWords, screenChanged, UNCHANGED_MARK } from './dahlia-game-player'

function setup(steps: (DahliaGameStep | Error)[], windowOverrides: Partial<DahliaGameWindow> = {}) {
  let now = 0
  const moves: string[] = []
  const window: DahliaGameWindow = {
    find: vi.fn(async () => ({ hwnd: 7, title: 'Dark War: Survival' })),
    capture: vi.fn(async () => ({ image: 'data:image/png;base64,cG5n' })),
    tap: vi.fn(async (_hwnd, x, y) => void moves.push(`tap ${x},${y}`)),
    swipe: vi.fn(async () => void moves.push('swipe')),
    back: vi.fn(async () => void moves.push('back')),
    show: vi.fn(async () => {}),
    ...windowOverrides,
  }
  const requests: unknown[] = []
  const step = vi.fn(async (request: unknown) => {
    requests.push(request)
    const next = steps.shift()
    if (!next)
      return { thought: 'Nothing left.', action: { type: 'done' as const, summary: 'Finished.' } }
    if (next instanceof Error)
      throw next
    return next
  })
  const player = new DahliaGamePlayer({
    window,
    step,
    sleep: async (ms) => {
      now += ms
    },
    now: () => now,
  })
  return { player, window, moves, requests, step }
}

const session = { game: 'dark-war-survival', windowTitle: 'Dark War', goal: 'collect rewards', minutes: 30 }

/** A capture thumbnail of one gray level. */
function sig(level: number) {
  return btoa(String.fromCharCode(...Array.from<number>({ length: 256 }).fill(level)))
}

describe('dahlia game player', () => {
  it('sends the screen\'s words, and shows a move her server made without her model', async () => {
    const words = [{ t: 'FREE', x: 700, y: 800, w: 90, h: 30, l: 0 }]
    const { player, requests } = setup([
      { thought: 'A FREE button.', action: { type: 'tap', x: 745, y: 815 }, quick: true },
    ], { capture: vi.fn(async () => ({ image: 'data:image/png;base64,cG5n', words })) })

    await player.start(session)

    expect(requests[0]).toMatchObject({ words })
    expect(player.state.log[1]).toBe('quick: tap (745, 815): A FREE button.')
  })

  it('marks a move that changed nothing, and goes back after three', async () => {
    const { player, moves, requests } = setup([
      { thought: 'Claim.', action: { type: 'tap', x: 500, y: 500 } },
      { thought: 'Claim again.', action: { type: 'tap', x: 500, y: 500 } },
      { thought: 'Once more.', action: { type: 'tap', x: 510, y: 500 } },
    ], { capture: vi.fn(async () => ({ image: 'data:image/png;base64,cG5n', sig: sig(90) })) })

    await player.start(session)

    expect(moves).toEqual(['tap 500,500', 'tap 500,500', 'tap 510,500', 'back'])
    expect((requests[1] as { history: { action: string }[] }).history[0].action).toBe(`tap (500, 500) ${UNCHANGED_MARK}`)
    expect((requests[3] as { history: { action: string }[] }).history.map(h => h.action)).toEqual([
      `tap (500, 500) ${UNCHANGED_MARK}`,
      `tap (500, 500) ${UNCHANGED_MARK}`,
      `tap (510, 500) ${UNCHANGED_MARK}`,
      `back ${UNCHANGED_MARK}`,
    ])
    expect(player.state.log).toContain('back: Stuck: 3 moves changed nothing, so I go back.')
  })

  it('tells a changed screen from the same one', () => {
    const changed = btoa(String.fromCharCode(...Array.from({ length: 256 }, (_, i) => (i < 40 ? 200 : 90))))
    const flicker = btoa(String.fromCharCode(...Array.from({ length: 256 }, (_, i) => (i < 40 ? 100 : 90))))
    expect(screenChanged(sig(90), changed)).toBe(true)
    expect(screenChanged(sig(90), flicker)).toBe(false)
    expect(screenChanged(sig(90), undefined)).toBe(true)
    expect(parseScreenWords('[{"t":"Claim","x":1,"y":2,"w":3,"h":4,"l":0},{"t":"","x":1,"y":2,"w":3,"h":4,"l":0},{"t":"x"}]')).toEqual([{ t: 'Claim', x: 1, y: 2, w: 3, h: 4, l: 0 }])
    expect(parseScreenWords('[]')).toBeUndefined()
    expect(parseScreenWords('not json')).toBeUndefined()
  })

  it('captures, asks for a move and makes it, until she is done', async () => {
    const { player, window, moves, requests } = setup([
      { thought: 'A chest.', action: { type: 'tap', x: 500, y: 900 } },
      { thought: 'Scroll the map.', action: { type: 'swipe', x1: 500, y1: 700, x2: 500, y2: 300 }, note: 'The farm is north.' },
      { thought: 'An offer pop-up.', action: { type: 'back' } },
    ])

    await player.start(session)

    expect(moves).toEqual(['tap 500,900', 'swipe', 'back'])
    expect(requests[0]).toMatchObject({ game: 'dark-war-survival', goal: 'collect rewards', image: 'data:image/png;base64,cG5n', history: [] })
    expect((requests[3] as { history: unknown[] }).history).toEqual([
      { action: 'tap (500, 900)', thought: 'A chest.' },
      { action: 'swipe (500, 700) to (500, 300)', thought: 'Scroll the map.' },
      { action: 'back', thought: 'An offer pop-up.' },
    ])
    expect(player.state).toMatchObject({ running: false, steps: 4, ended: 'Done: Finished.' })
    expect(window.show).toHaveBeenCalledWith(7)
    expect(player.state.log[0]).toBe('Playing in the window "Dark War: Survival".')
    expect(player.state.log[2]).toBe('swipe (500, 700) to (500, 300): Scroll the map. (noted: The farm is north.)')
  })

  it('stops when the time is up', async () => {
    const { player } = setup(Array.from({ length: 1000 }, () => ({ thought: 'Wait.', action: { type: 'wait' as const, seconds: 10 } })))

    await player.start({ ...session, minutes: 1 })

    expect(player.state.ended).toBe('Time is up.')
    expect(player.state.steps).toBeLessThan(10)
  })

  it('says why when the game window isn\'t open', async () => {
    const closed = vi.fn(async () => {
      throw new Error('No open window has "Dark War" in its title. Is the game open?')
    })
    const { player, step } = setup([], { find: closed })

    await player.start(session)

    expect(player.state).toMatchObject({ running: false, ended: 'No open window has "Dark War" in its title. Is the game open?' })
    expect(step).not.toHaveBeenCalled()
  })

  it('tries again when her server fails, and gives up after three failures in a row', async () => {
    const { player } = setup([new Error('Dahlia\'s model is not reachable right now.'), { thought: 'ok', action: { type: 'tap', x: 1, y: 1 } }, new Error('a'), new Error('b'), new Error('c')])

    await player.start(session)

    // One failure, a move, then three failures in a row end the session.
    expect(player.state.ended).toBe('c')
    expect(player.state.log.filter(line => line.startsWith('Problem:'))).toHaveLength(4)
    expect(player.state.steps).toBe(1)
  })

  it('stops when asked, and a second start only changes the goal', async () => {
    let release!: () => void
    const { player, window } = setup([])
    window.capture = vi.fn(() => new Promise<{ image: string }>((resolve) => {
      release = () => resolve({ image: 'data:image/png;base64,cG5n' })
    }))
    const playing = player.start(session)
    await Promise.resolve()
    await player.start({ ...session, goal: 'upgrade the headquarters' })
    expect(player.state.goal).toBe('upgrade the headquarters')

    player.stop('Stopped when asked.')
    release()
    await playing
    expect(player.state).toMatchObject({ running: false, ended: 'Stopped when asked.' })
  })

  it('describes moves for the log', () => {
    expect(describeGameAction({ type: 'wait', seconds: 3 })).toBe('wait 3 s')
  })
})
