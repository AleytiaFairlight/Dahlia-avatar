// Dahlia: runs PowerShell commands for Dahlia, when she is asked from the user's other devices (the
// "powershell" tool of src/renderer/dahlia-remote-tools.ts), on the "dahlia:powershell" channel. Each
// command runs in a new Windows PowerShell in the user's home folder, without a window, and returns its
// output. This file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls
// setupDahliaPowerShell() when the main process starts.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import os from 'node:os'
import process from 'node:process'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'

import { ipcMain } from 'electron'

export const DAHLIA_POWERSHELL_CHANNEL = 'dahlia:powershell'
export const DAHLIA_POWERSHELL_MAX_OUTPUT = 16_000
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000

export interface DahliaPowerShellRequest {
  command: string
  timeoutSeconds?: number
}

export interface DahliaPowerShellResult {
  ok: boolean
  exitCode: number | null
  output: string
  timedOut: boolean
}

/** The arguments of powershell.exe for a command: UTF-8 output, and the command encoded so no quoting breaks it. */
export function powerShellArguments(command: string) {
  const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$ProgressPreference = 'SilentlyContinue'\n${command}`
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
}

/** Runs a command and collects its output, cut at the limit, until it ends or the time is up. */
export function runDahliaPowerShell(
  request: DahliaPowerShellRequest,
  start: (args: string[]) => ChildProcessWithoutNullStreams = args => spawn('powershell.exe', args, { windowsHide: true, cwd: os.homedir() }),
  stop: (child: ChildProcessWithoutNullStreams) => void = stopTree,
): Promise<DahliaPowerShellResult> {
  const command = typeof request?.command === 'string' ? request.command.trim() : ''
  if (!command)
    return Promise.resolve({ ok: false, exitCode: null, output: 'No command was given.', timedOut: false })

  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, (Number(request.timeoutSeconds) || DEFAULT_TIMEOUT_MS / 1000) * 1000))
  return new Promise((resolve) => {
    let output = ''
    let cut = false
    let timedOut = false
    const add = (chunk: unknown) => {
      if (cut)
        return
      output += String(chunk)
      if (output.length > DAHLIA_POWERSHELL_MAX_OUTPUT) {
        output = output.slice(0, DAHLIA_POWERSHELL_MAX_OUTPUT)
        cut = true
      }
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = start(powerShellArguments(command))
    }
    catch (error) {
      resolve({ ok: false, exitCode: null, output: `PowerShell couldn't start: ${(error as Error).message}`, timedOut: false })
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      stop(child)
    }, timeoutMs)
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, exitCode: null, output: `PowerShell couldn't start: ${error.message}`, timedOut: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      let text = output.trimEnd()
      if (cut)
        text += '\n[cut: the output was longer]'
      if (timedOut)
        text += `\n[stopped after ${Math.round(timeoutMs / 1000)} seconds]`
      resolve({ ok: !timedOut && code === 0, exitCode: code, output: text || '(no output)', timedOut })
    })
  })
}

/** Ends PowerShell and what it started. */
function stopTree(child: ChildProcessWithoutNullStreams) {
  if (process.platform === 'win32' && child.pid)
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else
    child.kill()
}

/** Answers "dahlia:powershell" requests: on Windows only. */
export function setupDahliaPowerShell() {
  ipcMain.handle(DAHLIA_POWERSHELL_CHANNEL, (_event, request: DahliaPowerShellRequest) => process.platform === 'win32'
    ? runDahliaPowerShell(request)
    : { ok: false, exitCode: null, output: 'PowerShell runs only in the Windows app.', timedOut: false })
}
