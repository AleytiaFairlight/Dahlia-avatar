// Dahlia: tests for dahlia-game-start.ts, which program the game_launch tool starts.
import { describe, expect, it, vi } from 'vitest'

import { startGameProgram } from './dahlia-game-start'

const LAUNCHER = 'C:\\Games\\DarkWar\\Launcher.exe'

/** A launcher that starts only the programs in `starts`, and says why the others didn't. */
function launcher(...starts: string[]) {
  return vi.fn(async (path: string) => starts.includes(path) ? { ok: true } : { ok: false, error: `Give the full path of a program (.exe) or a shortcut (.lnk, .url). (${path})` })
}

describe('startGameProgram', () => {
  it('starts the game inside the folder she gave', async () => {
    // ROOT CAUSE:
    //
    // She found the game's folder and passed it as the path. A folder can't be started, and with a path given
    // the tool gave up instead of looking, so she couldn't launch the game.
    const launch = launcher(LAUNCHER)
    const searchIn = vi.fn(async (folder: string) => folder === 'C:\\Games\\DarkWar' ? LAUNCHER : undefined)

    const started = await startGameProgram({ given: 'C:\\Games\\DarkWar', searchIn, search: async () => undefined, launch })

    expect(started).toEqual({ file: LAUNCHER, tried: 2, lastError: expect.stringContaining('C:\\Games\\DarkWar') })
    expect(launch.mock.calls.map(([path]) => path)).toEqual(['C:\\Games\\DarkWar', LAUNCHER])
  })

  it('falls back to the program that started the game last time, then to a search', async () => {
    const remembered = await startGameProgram({ given: 'C:\\nope.exe', remembered: LAUNCHER, searchIn: async () => undefined, search: async () => undefined, launch: launcher(LAUNCHER) })
    expect(remembered.file).toBe(LAUNCHER)

    const searched = await startGameProgram({ searchIn: async () => undefined, search: async () => LAUNCHER, launch: launcher(LAUNCHER) })
    expect(searched).toEqual({ file: LAUNCHER, tried: 1, lastError: undefined })
  })

  it('tries each program once, survives a failing search, and says why the last one didn\'t start', async () => {
    const launch = launcher()

    const started = await startGameProgram({
      given: LAUNCHER,
      remembered: LAUNCHER,
      searchIn: async () => { throw new Error('C:\\Games\\DarkWar\\Launcher.exe isn\'t a folder.') },
      search: async () => LAUNCHER,
      launch,
    })

    expect(started.file).toBeUndefined()
    expect(started.tried).toBe(1)
    expect(launch).toHaveBeenCalledTimes(1)
    expect(started.lastError).toContain('Give the full path')
  })

  it('reports that nothing was found when there is nothing to try', async () => {
    const started = await startGameProgram({ searchIn: async () => undefined, search: async () => undefined, launch: launcher() })

    expect(started).toEqual({ file: undefined, tried: 0, lastError: undefined })
  })
})
