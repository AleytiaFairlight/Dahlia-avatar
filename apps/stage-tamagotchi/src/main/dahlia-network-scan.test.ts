// Dahlia: tests for dahlia-network-scan.ts, the nmap recon tool for Dahlia's other devices.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { expandTargetHosts, isAgentHeavyScan, parsePortList, runAgentNetworkScanViaMcp, runDahliaNetworkScan, scanArguments } from './dahlia-network-scan'

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
  it('builds recon flags for light scans locally; heavy scans moved to the Dahlia Agent via MCP', () => {
    expect(scanArguments({ target: '192.168.10.0/24', scanType: 'discovery' })).toEqual(['-sn', '-T4', '--host-timeout', '120s', '-oN', '-', '192.168.10.0/24'])
    expect(scanArguments({ target: '10.0.0.5', scanType: 'ports', ports: '22,80,443' })).toEqual(['-sT', '-Pn', '-p', '22,80,443', '-T4', '--host-timeout', '120s', '-oN', '-', '10.0.0.5'])
    expect(scanArguments({ target: 'host.example.com', scanType: 'service' })).toContain('-sV')
    // Heavy NSE/flag scans no longer execute locally: they delegate to the Agent via MCP.
    expect(scanArguments({ target: '192.168.1.1', scanType: 'vuln' })).toMatchObject({ error: expect.stringContaining('Dahlia Agent') })
    expect(scanArguments({ target: '192.168.1.1', scanType: 'intrusive', allowIntrusive: true })).toMatchObject({ error: expect.stringContaining('Dahlia Agent') })
    expect(scanArguments({ target: '192.168.1.1', scanType: 'exploit', allowIntrusive: true })).toMatchObject({ error: expect.stringContaining('Dahlia Agent') })
  })

  it('rejects raw-packet connect types locally (Agent MCP only)', () => {
    expect(scanArguments({ target: '10.0.0.5', scanType: 'ports' })).toEqual(expect.arrayContaining(['-sT']))
    expect(scanArguments({ target: '10.0.0.5', scanType: 'ports', connectType: 'syn', allowIntrusive: true })).toMatchObject({ error: expect.stringContaining('Dahlia Agent') })
    expect(scanArguments({ target: '10.0.0.5', scanType: 'ports', connectType: 'syn-fin', allowIntrusive: true })).toMatchObject({ error: expect.stringContaining('Dahlia Agent') })
    expect(scanArguments({ target: '10.0.0.5', scanType: 'ports', connectType: 'syn-rst', allowIntrusive: true })).toMatchObject({ error: expect.stringContaining('Dahlia Agent') })
    expect(scanArguments({ target: '10.0.0.5', scanType: 'service', connectType: 'bogus' as never })).toMatchObject({ error: expect.stringContaining('connect type') })
  })

  it('refuses a target that could inject a flag or shell text', () => {
    expect(scanArguments({ target: '-oX /tmp/x' })).toMatchObject({ error: expect.stringContaining('target') })
    expect(scanArguments({ target: '192.168.1.1; rm -rf /' })).toMatchObject({ error: expect.any(String) })
    expect(scanArguments({ target: '192.168.1.1', ports: '22 --script exploit' })).toMatchObject({ error: expect.stringContaining('ports') })
  })

  it('uses the built-in scanner for light scans; heavy scans require the Agent MCP (no local fallback)', async () => {
    const start = vi.fn()
    const probe = vi.fn(async (host: string, _port: number) => ({ open: host === '192.168.10.4' && _port === 80 }))
    const result = await runDahliaNetworkScan({ target: '192.168.10.4', scanType: 'ports', ports: '80,443' }, start, undefined, () => null, probe)
    expect(start).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.output).toContain('192.168.10.4')
    expect(result.output).toContain('built-in scanner')

    // Heavy scans never execute locally: without an Agent URL they report the move, not "needs nmap".
    const vuln = await runDahliaNetworkScan({ target: '192.168.10.4', scanType: 'vuln' }, start, undefined, () => null, probe, null)
    expect(vuln.ok).toBe(false)
    expect(vuln.output).toContain('Dahlia Agent')

    const synNoAgent = await runDahliaNetworkScan({ target: '192.168.10.4', scanType: 'ports', connectType: 'syn', allowIntrusive: true }, start, undefined, () => null, probe, null)
    expect(synNoAgent.ok).toBe(false)
    expect(synNoAgent.output).toContain('Dahlia Agent')
  })

  it('expands targets and parses ports for the built-in scanner', () => {
    expect(expandTargetHosts('192.168.10.4')).toEqual(['192.168.10.4'])
    expect(expandTargetHosts('192.168.10.1-3')).toEqual(['192.168.10.1', '192.168.10.2', '192.168.10.3'])
    expect((expandTargetHosts('192.168.10.0/30') as string[]).length).toBe(2)
    expect(parsePortList('22,80-81')).toEqual([22, 80, 81])
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

  it('routes heavy scans to the Dahlia Agent via MCP while light scans stay local', async () => {
    // Heavy = vuln/intrusive/exploit or non-full connect; light = discovery/ports/service full (SSH/tasks).
    expect(isAgentHeavyScan({ target: '10.0.0.1', scanType: 'vuln' })).toBe(true)
    expect(isAgentHeavyScan({ target: '10.0.0.1', scanType: 'intrusive', allowIntrusive: true })).toBe(true)
    expect(isAgentHeavyScan({ target: '10.0.0.1', scanType: 'ports', connectType: 'syn', allowIntrusive: true })).toBe(true)
    expect(isAgentHeavyScan({ target: '10.0.0.1', scanType: 'discovery' })).toBe(false)
    expect(isAgentHeavyScan({ target: '10.0.0.1', scanType: 'ports' })).toBe(false)
    expect(isAgentHeavyScan({ target: '10.0.0.1', scanType: 'service' })).toBe(false)

    // Heavy scan calls the Agent MCP (mocked fetch proves the MCP path, not local nmap).
    const agentResult = { ok: true, exitCode: 0 as const, output: 'Nmap scan report for 10.0.0.1\nHost is up.\n[via Dahlia Agent MCP mocked]', timedOut: false }
    const agentCall = vi.fn(async () => agentResult)
    const start = vi.fn()
    const heavy = await runDahliaNetworkScan(
      { target: '10.0.0.1', scanType: 'vuln' },
      start,
      undefined,
      () => 'nmap',
      undefined,
      'http://agent:8096/mcp',
      agentCall,
    )
    expect(agentCall).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
    expect(heavy.output).toContain('[via Dahlia Agent MCP mocked]')

    // Light scan stays local even when an Agent URL is configured (SSH/network tasks not stripped).
    const probe = vi.fn(async () => ({ open: false }))
    agentCall.mockClear()
    const lightStart = vi.fn()
    const light = await runDahliaNetworkScan(
      { target: '192.168.10.4', scanType: 'ports', ports: '80' },
      lightStart,
      undefined,
      () => null,
      probe,
      'http://agent:8096/mcp',
      agentCall,
    )
    expect(agentCall).not.toHaveBeenCalled()
    expect(light.output).toContain('built-in scanner')

    // Agent failure is reported as Agent-only: no silent local NSE fallback.
    const failingCall = vi.fn(async () => { throw new Error('agent down') })
    const failed = await runDahliaNetworkScan(
      { target: '10.0.0.1', scanType: 'vuln' },
      vi.fn(),
      undefined,
      () => 'nmap',
      undefined,
      'http://agent:8096/mcp',
      failingCall,
    )
    expect(failingCall).toHaveBeenCalledOnce()
    expect(failed.ok).toBe(false)
    expect(failed.output).toContain('Agent MCP failed')
    expect(failed.output).toContain('no local NSE execution')
  })

  it('calls the real Agent MCP server over HTTP (initialize + tools/call network_scan)', async () => {
    const net = await import('node:net')
    const srv = net.createServer()
    await new Promise<void>(resolve => srv.listen(0, resolve))
    const freePort = (srv.address() as { port: number }).port
    await new Promise<void>(resolve => srv.close(() => resolve()))
    const { spawn: spawn2 } = await import('node:child_process')
    const path = await import('node:path')
    // Canonical home is the dahlia-agent repo; fall back to the old mirror path during transition.
    const candidates = [
      process.env.DAHLIA_AGENT_REPO ? `${process.env.DAHLIA_AGENT_REPO}/mcp-server/dahlia-agent-mcp.py` : '',
      '/tmp/dahlia-agent/mcp-server/dahlia-agent-mcp.py',
      path.resolve(process.cwd(), '../../../deploy/compute/mcp-server/dahlia-agent-mcp.py'),
    ].filter(Boolean)
    const fs = await import('node:fs')
    const mcpScript = candidates.find(p => fs.existsSync(p))
    if (!mcpScript)
      throw new Error(`Agent MCP server not found (tried ${candidates.join(', ')}); canonical: AleytiaFairlight/dahlia-agent mcp-server/dahlia-agent-mcp.py`)
    const mcp = spawn2('python3', [mcpScript, String(freePort)], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const url = `http://127.0.0.1:${freePort}/mcp`
      let ready = false
      for (let i = 0; i < 50 && !ready; i++) {
        try {
          const init = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, id: 1 }) })
          ready = init.ok
        }
        catch { await new Promise(r => setTimeout(r, 200)) }
      }
      expect(ready).toBe(true)
      const viaAgent = await runAgentNetworkScanViaMcp({ target: '127.0.0.1', scanType: 'ports', ports: '22' }, url)
      expect(viaAgent.ok).toBe(true)
      expect(viaAgent.output).toContain('127.0.0.1')
      expect(viaAgent.output).toContain('[via Dahlia Agent MCP')
    }
    finally {
      mcp.kill()
    }
  }, 30_000)
})
