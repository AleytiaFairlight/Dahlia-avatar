// Dahlia: tests for dahlia-network-scan.ts, the nmap recon tool for Dahlia's other devices.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { runDahliaNetworkScan, scanArguments } from './dahlia-network-scan'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

/** An nmap process that writes the given output and exits with the code. */
function fakeNmap(output: string[], code: number | undefined) {
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

describe('dahlia network scan', () => {
  it('builds recon flags for each scan type, never exploit or dos scripts', () => {
    expect(scanArguments({ target: '192.168.10.0/24', scanType: 'discovery' })).toEqual(['-sn', '-T4', '--host-timeout', '120s', '-oN', '-', '192.168.10.0/24'])
    expect(scanArguments({ target: '10.0.0.5', scanType: 'ports', ports: '22,80,443' })).toEqual(['-sT', '-Pn', '-p', '22,80,443', '-T4', '--host-timeout', '120s', '-oN', '-', '10.0.0.5'])
    expect(scanArguments({ target: 'host.example.com', scanType: 'service' })).toContain('-sV')
    const vuln = scanArguments({ target: '192.168.1.1', scanType: 'vuln' }) as string[]
    expect(vuln).toEqual(expect.arrayContaining(['--script', 'vuln']))
    expect(vuln.join(' ')).not.toMatch(/exploit|dos|\bintrusive\b/)
  })

  it('refuses a target that could inject a flag or shell text', () => {
    expect(scanArguments({ target: '-oX /tmp/x' })).toMatchObject({ error: expect.stringContaining('target') })
    expect(scanArguments({ target: '192.168.1.1; rm -rf /' })).toMatchObject({ error: expect.any(String) })
    expect(scanArguments({ target: '192.168.1.1', ports: '22 --script exploit' })).toMatchObject({ error: expect.stringContaining('ports') })
  })

  it('says so when nmap is not installed, and runs nothing', async () => {
    const start = vi.fn()
    const result = await runDahliaNetworkScan({ target: '192.168.10.0/24', scanType: 'discovery' }, start, undefined, () => null)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('nmap is not installed')
    expect(start).not.toHaveBeenCalled()
  })

  it('runs nmap with the built flags and returns its report', async () => {
    let seen: { file: string, args: string[] } | undefined
    const result = await runDahliaNetworkScan(
      { target: '192.168.10.0/24', scanType: 'discovery' },
      (file, args) => {
        seen = { file, args }
        return fakeNmap(['Nmap scan report for 192.168.10.4\nHost is up.\n'], 0)
      },
      undefined,
      () => 'nmap',
    )
    expect(seen).toEqual({ file: 'nmap', args: ['-sn', '-T4', '--host-timeout', '120s', '-oN', '-', '192.168.10.0/24'] })
    expect(result).toMatchObject({ ok: true, exitCode: 0 })
    expect(result.output).toContain('192.168.10.4')
  })

  it('stops a scan that runs too long', async () => {
    const stop = vi.fn((child: ChildProcessWithoutNullStreams) => child.emit('close', null))
    const result = await runDahliaNetworkScan(
      { target: '10.0.0.0/8', scanType: 'service', timeoutSeconds: 1 },
      () => fakeNmap(['scanning...'], undefined),
      stop,
      () => 'nmap',
    )
    expect(stop).toHaveBeenCalledOnce()
    expect(result.timedOut).toBe(true)
    expect(result.output).toContain('[stopped after 5 seconds]')
  }, 10_000)
})
