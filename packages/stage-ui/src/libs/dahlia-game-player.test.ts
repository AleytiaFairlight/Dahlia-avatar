// Dahlia: tests for dahlia-game-player.ts, Dahlia playing a game in a window.
import type { DahliaGameStep, DahliaGameWindow } from './dahlia-game-player'

import { describe, expect, it, vi } from 'vitest'

import { DahliaGamePlayer, describeGameAction } from './dahlia-game-player'

function setup(steps: (DahliaGameStep | Error)[], windowOverrides: Partial<DahliaGameWindow> = {}) {
  let now = 0
  const moves: string[] = []
  const window: DahliaGameWindow = {
    find: vi.fn(async () => ({ hwnd: 7, title: 'Dark War: Survival' })),
    capture: vi.fn(async () => ({ png: 'cG5n' })),
    tap: vi.fn(async (_hwnd, x, y) => void moves.push(`tap ${x},${y}`)),
    swipe: vi.fn(async () => void moves.push('swipe')),
    back: vi.fn(async () => void moves.push('back')),
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

describe('dahlia game player', () => {
  it('captures, asks for a move and makes it, until she is done', async () => {
    const { player, moves, requests } = setup([
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
    expect(player.state.log[1]).toBe('swipe (500, 700) to (500, 300): Scroll the map. (noted: The farm is north.)')
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
    window.capture = vi.fn(() => new Promise<{ png: string }>((resolve) => {
      release = () => resolve({ png: 'cG5n' })
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
