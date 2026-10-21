// Dahlia: lets Dahlia look up and read files on this computer, through the read-only MCP server in
// resources/dahlia-files-mcp.mjs. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls ensureDahliaFilesServer() before the MCP servers start.
//
// The server runs on the app's own executable in Node mode, so nothing has to be installed. Its entry
// in mcp.json is added once; after that the user's choices stay: removing the entry or setting
// "enabled": false keeps it off, and folders listed after the script path replace the default folders.
// Each start updates the executable and script paths, which change when the app moves.

import process from 'node:process'

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'

import filesServerScript from '../../resources/dahlia-files-mcp.mjs?asset&asarUnpack'

export const DAHLIA_FILES_SERVER = 'dahlia-files'

/** Written to userData once the entry was added, so a removed entry stays removed. */
const ADDED_MARKER = 'dahlia-files-mcp-added'

interface StdioEntry {
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
  [key: string]: unknown
}

/**
 * The mcp.json text with Dahlia's file server added or its paths brought up to date, or undefined when
 * nothing changes.
 */
export function withDahliaFilesServer(configText: string, command: string, script: string, addIfMissing: boolean): string | undefined {
  let config: { mcpServers?: Record<string, unknown>, [key: string]: unknown }
  try {
    config = JSON.parse(configText)
  }
  catch {
    // A file the user broke stays as it is; the settings page shows the error.
    return undefined
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config))
    return undefined

  const servers = (config.mcpServers ??= {}) as Record<string, unknown>
  const current = servers[DAHLIA_FILES_SERVER] as StdioEntry | undefined
  if (current === undefined) {
    if (!addIfMissing)
      return undefined
    servers[DAHLIA_FILES_SERVER] = { command, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  else {
    if (typeof current !== 'object' || current === null || typeof current.command !== 'string')
      return undefined
    const folders = (current.args ?? []).slice(1)
    if (current.command === command && current.args?.[0] === script && current.env?.ELECTRON_RUN_AS_NODE === '1')
      return undefined
    servers[DAHLIA_FILES_SERVER] = { ...current, command, args: [script, ...folders], env: { ...current.env, ELECTRON_RUN_AS_NODE: '1' } }
  }
  return `${JSON.stringify(config, null, 2)}\n`
}

/** Adds Dahlia's file server to mcp.json the first time, and keeps its paths right after that. */
export async function ensureDahliaFilesServer() {
  const userData = app.getPath('userData')
  const configPath = join(userData, 'mcp.json')
  const markerPath = join(userData, ADDED_MARKER)
  try {
    const added = await readFile(markerPath, 'utf-8').then(() => true, () => false)
    const next = withDahliaFilesServer(await readFile(configPath, 'utf-8'), process.execPath, filesServerScript, !added)
    if (next !== undefined)
      await writeFile(configPath, next)
    if (!added)
      await writeFile(markerPath, `${new Date().toISOString()}\n`)
  }
  catch (error) {
    console.warn('Dahlia: could not set up the file server', error)
  }
}
