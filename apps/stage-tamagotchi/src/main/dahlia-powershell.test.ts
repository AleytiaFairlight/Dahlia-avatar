// Dahlia: tests for dahlia-powershell.ts, PowerShell commands for Dahlia's other devices.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { DAHLIA_POWERSHELL_MAX_OUTPUT, powerShellArguments, runDahliaPowerShell } from './dahlia-powershell'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

/** A PowerShell that writes the given output and exits with the code, or never exits. */
function fakePowerShell(output: string[], code: number | undefined) {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams & EventEmitter
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  Object.assign(child, { stdin: new PassThrough(), stdout, stderr })
  setTimeout(() => {
    for (const line of output)
      stdout.write(line)
    if (code !== undefined)
      setTimeout(() => child.emit('close', code), 5)
  }, 1)
  return child
}

describe('dahlia powershell', () => {
  it('encodes the command, so quotes and new lines arrive as written', () => {
    const args = powerShellArguments('Get-ChildItem "C:\\Users"\nWrite-Output \'done\'')
    expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
    const script = Buffer.from(args[5], 'base64').toString('utf16le')
    expect(script).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8')
    expect(script.endsWith('Get-ChildItem "C:\\Users"\nWrite-Output \'done\'')).toBe(true)
  })

  it('returns the output and the exit code', async () => {
    const result = await runDahliaPowerShell({ command: 'Get-Date' }, () => fakePowerShell(['Friday\r\n'], 0))
    expect(result).toEqual({ ok: true, exitCode: 0, output: 'Friday', timedOut: false })
  })

  it('cuts long output and stops a command that runs too long', async () => {
    const stop = vi.fn((child: ChildProcessWithoutNullStreams) => child.emit('close', null))
    const result = await runDahliaPowerShell(
      { command: 'while ($true) { "x" * 1000 }', timeoutSeconds: 1 },
      () => fakePowerShell(['x'.repeat(DAHLIA_POWERSHELL_MAX_OUTPUT + 10)], undefined),
      stop,
    )
    expect(stop).toHaveBeenCalledOnce()
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.output).toContain('[cut: the output was longer]')
    expect(result.output).toContain('[stopped after 1 seconds]')
  })

  it('refuses an empty command', async () => {
    const start = vi.fn()
    expect(await runDahliaPowerShell({ command: '  ' }, start)).toMatchObject({ ok: false, output: 'No command was given.' })
    expect(start).not.toHaveBeenCalled()
  })
})
