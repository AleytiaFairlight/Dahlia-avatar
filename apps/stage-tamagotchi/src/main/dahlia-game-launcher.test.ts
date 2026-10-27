// Dahlia: tests for dahlia-game-launcher.ts, finding and starting games for Dahlia.
import type { DahliaGameSearchDeps } from './dahlia-game-launcher'

import { describe, expect, it, vi } from 'vitest'

import { findGame, nameMatches } from './dahlia-game-launcher'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, shell: {} }))

/** A Windows disk: folders end with \, files map to nothing. */
function disk(paths: string[], overrides: Partial<DahliaGameSearchDeps> = {}): DahliaGameSearchDeps {
  const entries = new Map<string, Map<string, boolean>>()
  for (const full of paths) {
    const parts = full.replace(/\\$/, '').split('\\')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('\\') + (i === 1 ? '\\' : '')
      const isDirectory = i < parts.length - 1 || full.endsWith('\\')
      const children = entries.get(parent.toLowerCase()) ?? new Map()
      children.set(parts[i], children.get(parts[i]) || isDirectory)
      entries.set(parent.toLowerCase(), children)
    }
  }
  return {
    readdir: async (folder) => {
      const children = entries.get(folder.toLowerCase())
      if (!children)
        throw new Error('ENOENT')
      return [...children].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory }))
    },
    exists: file => entries.has(file.toLowerCase()) || paths.some(p => p.toLowerCase() === file.toLowerCase()),
    shortcutTarget: () => undefined,
    installedPrograms: async () => [],
    env: { ProgramFiles: 'C:\\Program Files', APPDATA: 'C:\\Users\\a\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\a', ProgramData: 'C:\\ProgramData' },
    drives: () => ['C:\\', 'D:\\'],
    now: () => 0,
    ...overrides,
  }
}

describe('dahlia game launcher', () => {
  it('matches names with every word, or by their start', () => {
    expect(nameMatches('Dark War Survival.lnk', 'Dark War: Survival')).toBe(true)
    expect(nameMatches('DarkWarSurvival', 'Dark War Survival')).toBe(true)
    expect(nameMatches('DarkWar', 'Dark War Survival')).toBe(true)
    expect(nameMatches('War', 'Dark War Survival')).toBe(false)
    expect(nameMatches('Warframe', 'Dark War Survival')).toBe(false)
  })

  it('finds the game in a folder on another drive, its own program before its helpers', async () => {
    const found = await findGame('Dark War Survival', undefined, disk([
      'C:\\Program Files\\Other\\other.exe',
      'D:\\Games\\DarkWar\\DarkWar.exe',
      'D:\\Games\\DarkWar\\launcher.exe',
      'D:\\Games\\DarkWar\\unins000.exe',
      'D:\\Games\\DarkWar\\UnityCrashHandler64.exe',
    ]))

    expect(found.map(candidate => candidate.path)).toEqual(['D:\\Games\\DarkWar\\DarkWar.exe', 'D:\\Games\\DarkWar\\launcher.exe'])
  })

  it('puts a Start menu shortcut first, once with its target', async () => {
    const lnk = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Dark War Survival\\Dark War Survival.lnk'
    const found = await findGame('Dark War Survival', undefined, disk([
      lnk,
      'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Dark War Survival\\Uninstall Dark War Survival.lnk',
      'C:\\Program Files\\Dark War Survival\\DarkWar.exe',
    ], { shortcutTarget: file => file === lnk ? 'C:\\Program Files\\Dark War Survival\\DarkWar.exe' : undefined }))

    expect(found[0]).toMatchObject({ path: lnk, source: 'shortcut', target: 'C:\\Program Files\\Dark War Survival\\DarkWar.exe' })
    expect(found.filter(candidate => (candidate.target ?? candidate.path).endsWith('DarkWar.exe'))).toHaveLength(1)
  })

  it('uses the installed-programs list: its icon program and its folder', async () => {
    const found = await findGame('Dark War Survival', undefined, disk([
      'E:\\FP\\dws\\Game.exe',
      'E:\\FP\\dws\\bin\\Engine.exe',
    ], { installedPrograms: async () => [{ name: 'Dark War: Survival', folder: 'E:\\FP\\dws', icon: '"E:\\FP\\dws\\Game.exe",0' }] }))

    expect(found[0]).toMatchObject({ path: 'E:\\FP\\dws\\Game.exe', source: 'installed' })
    expect(found.map(candidate => candidate.path)).toContain('E:\\FP\\dws\\bin\\Engine.exe')
  })

  it('searches a folder the user names, deeper', async () => {
    const found = await findGame('Dark War Survival', 'D:\\Stuff', disk([
      'D:\\Stuff\\a\\b\\c\\d\\DarkWarSurvival.exe',
    ]))

    expect(found.map(candidate => candidate.path)).toEqual(['D:\\Stuff\\a\\b\\c\\d\\DarkWarSurvival.exe'])
  })
})
