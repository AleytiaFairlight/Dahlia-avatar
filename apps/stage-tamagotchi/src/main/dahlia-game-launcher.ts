// Dahlia: finds games installed on this PC and starts them, for Dahlia (the "game_find" and "game_launch"
// tools of src/renderer/dahlia-remote-tools.ts), on the "dahlia:game-launcher" channel. She looks where
// games are: Start menu and desktop shortcuts, the installed-programs list in the registry, Program Files,
// the Steam and Epic libraries and game folders on every drive. Only names are read; starting a game
// asks on the PC first (the tool isn't read-only). This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls setupDahliaGameLauncher() when the main process starts.

import process from 'node:process'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { win32 as path } from 'node:path'

import { ipcMain, shell } from 'electron'

import { runDahliaPowerShell } from './dahlia-powershell'

export const DAHLIA_GAME_LAUNCHER_CHANNEL = 'dahlia:game-launcher'

export type DahliaGameLauncherRequest
  = | { op: 'find', name: string, folder?: string }
    | { op: 'launch', path: string }

export interface DahliaGameCandidate {
  /** What to start: an .exe, or a shortcut (.lnk, .url) that starts it the way the user does. */
  path: string
  /** The program a shortcut starts, when it is one. */
  target?: string
  /** Where it was found: shortcut, installed (the registry), folder. */
  source: 'shortcut' | 'installed' | 'folder'
  score: number
}

export const LAUNCHABLE = new Set(['.exe', '.lnk', '.url', '.appref-ms'])
/** Programs next to a game that aren't the game. */
const NOT_THE_GAME = /unins|setup|install|update|patch|crash|report|helper|redist|vc_?redist|dxsetup|prereq|cef|webview|elevat|service|bugtrace|anticheat|easyanticheat|battleye/i
/** Folders never worth walking into. */
const SKIP_FOLDERS = new Set(['windows', '$recycle.bin', 'system volume information', 'node_modules', '.git', 'windowsapps', 'microsoft', 'common files', 'windows defender', 'windowspowershell', 'temp', 'cache', 'logs'])
const MAX_FOLDERS = 25_000
const SEARCH_MS = 25_000
const MAX_RESULTS = 10

/** Lower-case letters and digits only: "Dark War: Survival" -> "darkwarsurvival". */
export function compact(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Whether a file or folder name is the game's: every word of the name is in it ("Dark War Survival.lnk",
 * "DarkWarSurvival"), or it is the start of the name ("DarkWar" for "Dark War: Survival").
 */
export function nameMatches(candidate: string, name: string) {
  const c = compact(path.parse(candidate).name || candidate)
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 2)
  if (!c || words.length === 0)
    return false
  if (words.every(word => c.includes(word)))
    return true
  return c.length >= 5 && compact(name).startsWith(c)
}

export interface DahliaGameSearchDeps {
  readdir: (folder: string) => Promise<{ name: string, isDirectory: boolean, isFile: boolean }[]>
  exists: (file: string) => boolean
  /** The program a .lnk starts, or undefined. */
  shortcutTarget: (file: string) => string | undefined
  /** The installed programs: name, folder and icon (which is often the game's .exe). */
  installedPrograms: () => Promise<{ name: string, folder?: string, icon?: string }[]>
  env: Record<string, string | undefined>
  /** The drives to look on, such as ["C:\\", "D:\\"]. */
  drives: () => string[]
  now: () => number
}

/** The .exe files in a folder and the folders below it, at most `depth` deep. */
async function programsIn(folder: string, depth: number, deps: DahliaGameSearchDeps, budget: { folders: number, until: number }) {
  const found: { file: string, depth: number }[] = []
  const walk = async (dir: string, level: number) => {
    if (level > depth || budget.folders-- <= 0 || deps.now() > budget.until)
      return
    const entries = await deps.readdir(dir).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile && entry.name.toLowerCase().endsWith('.exe') && !NOT_THE_GAME.test(entry.name))
        found.push({ file: path.join(dir, entry.name), depth: level })
    }
    for (const entry of entries) {
      if (entry.isDirectory && !SKIP_FOLDERS.has(entry.name.toLowerCase()))
        await walk(path.join(dir, entry.name), level + 1)
    }
  }
  await walk(folder, 0)
  return found
}

/** The game's programs in its install folder, best first: named like the game, a launcher, near the top. */
async function gameProgramsIn(folder: string, name: string, base: number, deps: DahliaGameSearchDeps, budget: { folders: number, until: number }) {
  return (await programsIn(folder, 3, deps, budget)).map(({ file, depth }) => ({
    path: file,
    source: 'folder' as const,
    score: base + (nameMatches(path.basename(file), name) ? 3 : 0) + (/launcher/i.test(path.basename(file)) ? 1 : 0) - depth,
  }))
}

/** Finds a game's programs and shortcuts on this PC, best first. */
export async function findGame(name: string, folder: string | undefined, deps: DahliaGameSearchDeps): Promise<DahliaGameCandidate[]> {
  const budget = { folders: MAX_FOLDERS, until: deps.now() + SEARCH_MS }
  const found: DahliaGameCandidate[] = []
  const env = deps.env

  // Shortcuts: what the user clicks, with the right folder and arguments.
  const shortcutFolders = [
    env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    env.USERPROFILE && path.join(env.USERPROFILE, 'Desktop'),
    env.USERPROFILE && path.join(env.USERPROFILE, 'OneDrive', 'Desktop'),
    env.PUBLIC && path.join(env.PUBLIC, 'Desktop'),
  ].filter((dir): dir is string => !!dir)
  const walkShortcuts = async (dir: string, level: number) => {
    if (level > 3 || budget.folders-- <= 0)
      return
    for (const entry of await deps.readdir(dir).catch(() => [])) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory) {
        await walkShortcuts(file, level + 1)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      if (!entry.isFile || !LAUNCHABLE.has(ext) || ext === '.exe' || !nameMatches(entry.name, name) || NOT_THE_GAME.test(entry.name))
        continue
      const target = ext === '.lnk' ? deps.shortcutTarget(file) : undefined
      if (ext === '.lnk' && target && (!target.toLowerCase().endsWith('.exe') || NOT_THE_GAME.test(path.basename(target))))
        continue
      found.push({ path: file, target, source: 'shortcut', score: 10 })
    }
  }
  for (const dir of shortcutFolders)
    await walkShortcuts(dir, 0)

  // The installed-programs list: its icon is often the game's program, its folder holds it.
  for (const program of await deps.installedPrograms().catch(() => [])) {
    if (!nameMatches(program.name, name))
      continue
    const icon = program.icon?.replace(/^"|"?,-?\d+$|"$/g, '')
    if (icon?.toLowerCase().endsWith('.exe') && !NOT_THE_GAME.test(path.basename(icon)) && deps.exists(icon))
      found.push({ path: icon, source: 'installed', score: 9 })
    if (program.folder && deps.exists(program.folder))
      found.push(...(await gameProgramsIn(program.folder, name, 7, deps, budget)).map(candidate => ({ ...candidate, source: 'installed' as const })))
  }

  // Folders named like the game, where games are installed.
  const roots: { dir: string, depth: number }[] = []
  if (folder)
    roots.push({ dir: folder, depth: 6 })
  for (const dir of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.APPDATA]) {
    if (dir)
      roots.push({ dir, depth: 2 })
  }
  for (const drive of deps.drives()) {
    roots.push({ dir: drive, depth: 2 })
    for (const library of ['SteamLibrary\\steamapps\\common', 'Program Files (x86)\\Steam\\steamapps\\common', 'Program Files\\Epic Games', 'Games', 'XboxGames'])
      roots.push({ dir: path.join(drive, library), depth: 1 })
  }
  const walkFolders = async (dir: string, level: number, depth: number) => {
    if (level > depth || budget.folders-- <= 0 || deps.now() > budget.until)
      return
    for (const entry of await deps.readdir(dir).catch(() => [])) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory && !SKIP_FOLDERS.has(entry.name.toLowerCase())) {
        if (nameMatches(entry.name, name))
          found.push(...await gameProgramsIn(file, name, 5, deps, budget))
        else
          await walkFolders(file, level + 1, depth)
      }
      else if (folder && entry.isFile && entry.name.toLowerCase().endsWith('.exe') && nameMatches(entry.name, name) && !NOT_THE_GAME.test(entry.name)) {
        found.push({ path: file, source: 'folder', score: 6 })
      }
    }
  }
  for (const root of roots) {
    if (deps.exists(root.dir))
      await walkFolders(root.dir, 0, root.depth)
  }

  // One entry per program: a shortcut and its target are the same game.
  const best = new Map<string, DahliaGameCandidate>()
  for (const candidate of found) {
    const key = (candidate.target ?? candidate.path).toLowerCase()
    const known = best.get(key)
    if (!known || candidate.score > known.score)
      best.set(key, candidate)
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
}

/** Starts a program or shortcut, from its own folder, apart from this app. */
export async function launchGame(file: string): Promise<{ ok: true } | { ok: false, error: string }> {
  const target = typeof file === 'string' ? file.trim().replace(/^"|"$/g, '') : ''
  const ext = path.extname(target).toLowerCase()
  if (!path.isAbsolute(target) || !LAUNCHABLE.has(ext))
    return { ok: false, error: 'Give the full path of a program (.exe) or a shortcut (.lnk, .url).' }
  if (!existsSync(target))
    return { ok: false, error: `${target} doesn't exist.` }

  if (ext !== '.exe') {
    const error = await shell.openPath(target)
    return error ? { ok: false, error } : { ok: true }
  }
  return await new Promise((resolve) => {
    const child = spawn(target, [], { cwd: path.dirname(target), detached: true, stdio: 'ignore' })
    child.once('error', error => resolve({ ok: false, error: `It didn't start: ${error.message}` }))
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })
}

/** The installed programs of the registry (this user's and the machine's, 64- and 32-bit). */
async function installedPrograms() {
  const result = await runDahliaPowerShell({
    command: `$keys = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object { [pscustomobject]@{ name = [string]$_.DisplayName; folder = [string]$_.InstallLocation; icon = [string]$_.DisplayIcon } } | ConvertTo-Json -Compress`,
    timeoutSeconds: 20,
  })
  if (!result.ok)
    return []
  const parsed = JSON.parse(result.output) as { name: string, folder?: string, icon?: string } | { name: string, folder?: string, icon?: string }[]
  return (Array.isArray(parsed) ? parsed : [parsed]).map(program => ({ name: program.name, folder: program.folder || undefined, icon: program.icon || undefined }))
}

function electronDeps(): DahliaGameSearchDeps {
  return {
    readdir: async folder => (await readdir(folder, { withFileTypes: true })).map(entry => ({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile() })),
    exists: existsSync,
    shortcutTarget: (file) => {
      try {
        return shell.readShortcutLink(file).target || undefined
      }
      catch {
        return undefined
      }
    },
    installedPrograms,
    env: process.env,
    drives: () => 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `${letter}:\\`).filter(drive => existsSync(drive)),
    now: () => Date.now(),
  }
}

/** Answers "dahlia:game-launcher" requests: on Windows only. */
export function setupDahliaGameLauncher() {
  ipcMain.handle(DAHLIA_GAME_LAUNCHER_CHANNEL, async (_event, request: DahliaGameLauncherRequest) => {
    if (process.platform !== 'win32')
      return { ok: false, error: 'Finding and starting games works only in the Windows app.' }
    try {
      if (request?.op === 'find') {
        const name = typeof request.name === 'string' ? request.name.trim() : ''
        if (!name)
          return { ok: false, error: 'Give the game\'s name.' }
        const folder = typeof request.folder === 'string' && request.folder.trim() ? request.folder.trim() : undefined
        if (folder && !(await stat(folder).catch(() => undefined))?.isDirectory())
          return { ok: false, error: `${folder} isn't a folder.` }
        return { ok: true, candidates: await findGame(name, folder, electronDeps()) }
      }
      if (request?.op === 'launch')
        return await launchGame(request.path)
      return { ok: false, error: 'Unknown request.' }
    }
    catch (error) {
      return { ok: false, error: (error as Error).message || 'That failed.' }
    }
  })
}
