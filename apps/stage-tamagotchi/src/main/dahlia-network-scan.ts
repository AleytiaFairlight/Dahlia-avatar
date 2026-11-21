// Dahlia: local network scans for Dahlia, when she is asked from the user's other devices (the "network_scan"
// tool of src/renderer/dahlia-remote-tools.ts), on the "dahlia:network-scan" channel.
//
// SPLIT (Dahlia Agent owns heavy scanning): this file keeps the lightweight local scanner Dahlia needs
// for SSH and everyday network tasks — discovery, ports and service with full TCP connect via the
// built-in prober (no nmap, no admin). Heavy work (vuln / intrusive / exploit NSE categories and
// syn / syn-fin / syn-rst raw-packet probes) runs on the Dahlia Agent via MCP ONLY
// (deploy/compute/mcp-server/dahlia-agent-mcp.py, POST <agent>/mcp tools/call network_scan).
// runDahliaNetworkScan routes heavy scans to the Agent with no local NSE execution; light scans stay
// local. Full vulnerability scanners and Metasploit themselves run via the "powershell" tool
// (which asks on the PC for every command), not here.
// This file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls setupDahliaNetworkScan()
// when the main process starts.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { spawn } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { existsSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'
import { ipcMain } from 'electron'

export const DAHLIA_NETWORK_SCAN_CHANNEL = 'dahlia:network-scan'
export const DAHLIA_NETWORK_SCAN_MAX_OUTPUT = 24_000
const DEFAULT_TIMEOUT_MS = 180_000
const MAX_TIMEOUT_MS = 900_000
/** Built-in TCP fallback (no nmap needed): per-port timeout, hosts/ports caps. Full nmap adds NSE when installed. */
const BUILTIN_PROBE_TIMEOUT_MS = 1_500
const BUILTIN_MAX_HOSTS = 256
const BUILTIN_MAX_PORTS = 1_000
const BUILTIN_TOP_PORTS = [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 1723, 3306, 3389, 5900, 8080, 8443]
const BUILTIN_DISCOVERY_PORTS = [80, 443, 22, 445]
const BUILTIN_SERVICE_NAMES: Record<number, string> = { 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'domain', 80: 'http', 110: 'pop3', 135: 'msrpc', 139: 'netbios-ssn', 143: 'imap', 443: 'https', 445: 'microsoft-ds', 993: 'imaps', 995: 'pop3s', 1723: 'pptp', 3306: 'mysql', 3389: 'ms-wbt-server', 5900: 'vnc', 8080: 'http-proxy', 8443: 'https-alt' }

export type DahliaScanType = 'discovery' | 'ports' | 'service' | 'vuln' | 'intrusive' | 'exploit'

/**
 * TCP connection type. full = normal connect() (no admin, built-in works).
 * syn / syn-fin / syn-rst = raw-packet flag probes: nmap + admin/root (+ Npcap on
 * Windows) required, stealthier and more likely to be flagged. Needs allowIntrusive:true.
 */
export type DahliaConnectType = 'full' | 'syn' | 'syn-fin' | 'syn-rst'

export interface DahliaNetworkScanRequest {
  /** What to scan: a host name, an IPv4 address, a CIDR block, or a dash range (e.g. 192.168.10.1-254). */
  target: string
  /** discovery: which hosts are up. ports: which TCP ports are open. service: service and version. vuln: known-vulnerability detection. intrusive/exploit: NSE intrusive/exploit categories — only for networks you own or have written permission to test, and only with allowIntrusive:true. */
  scanType?: DahliaScanType
  /** The TCP ports, as nmap's -p takes them (e.g. "22,80,443" or "1-1024"). The default is nmap's top ports. */
  ports?: string
  /** full: TCP connect (default, no admin). syn: half-open SYN. syn-fin: SYN+FIN flags. syn-rst: SYN+RST flags (nmap + admin required; built-in fallback is full only). */
  connectType?: DahliaConnectType
  /** Required true for intrusive/exploit scan types and for non-full connect types: confirms the target is authorized for active testing. */
  allowIntrusive?: boolean
  timeoutSeconds?: number
}

export interface DahliaNetworkScanResult {
  ok: boolean
  exitCode: number | null
  output: string
  timedOut: boolean
}

/** A target nmap may be pointed at: a host name, IPv4 (optionally /CIDR), or a dash range. Never a flag. */
const TARGET = /^(?!-)[a-z0-9.\-/]{1,64}$/i
/** Ports as nmap's -p takes them: numbers, commas and dashes. */
const PORTS = /^[0-9,\-]{1,64}$/

/** The nmap flags for LIGHT scans only (discovery/ports/service, full connect). Heavy scans (vuln/intrusive/exploit, non-full connect) moved to the Dahlia Agent via MCP and are rejected here. */
export function scanArguments(request: DahliaNetworkScanRequest): string[] | { error: string } {
  const target = request.target?.trim() ?? ''
  if (!TARGET.test(target))
    return { error: 'The target must be a host name, an IP address, a CIDR block, or a dash range (for example 192.168.10.0/24).' }
  if (request.ports !== undefined && !PORTS.test(request.ports.trim()))
    return { error: 'The ports must be numbers, commas and dashes, as nmap\'s -p takes them (for example 22,80,443).' }
  const connectType = request.connectType ?? 'full'
  if (connectType !== 'full' && connectType !== 'syn' && connectType !== 'syn-fin' && connectType !== 'syn-rst')
    return { error: 'Unknown connect type. Use full, syn, syn-fin or syn-rst.' }
  if (isAgentHeavyScan(request))
    return { error: 'Heavy scans (vuln/intrusive/exploit, syn/syn-fin/syn-rst) moved to the Dahlia Agent: Dahlia runs them via MCP network_scan on the Agent, not locally. Light discovery/ports/service (full connect) stay local for SSH and network tasks.' }

  // -oN - writes the normal report to stdout; -T4 caps the speed; --host-timeout keeps one slow host from hanging the scan.
  const common = ['-T4', '--host-timeout', '120s', '-oN', '-']
  const ports = request.ports?.trim() ? ['-p', request.ports.trim()] : []
  switch (request.scanType ?? 'ports') {
    case 'discovery':
      return ['-sn', ...common, target]
    case 'ports':
      // -sT is a TCP connect scan, which needs no administrator rights on Windows.
      return ['-sT', '-Pn', ...ports, ...common, target]
    case 'service':
      return ['-sT', '-sV', '-Pn', ...ports, ...common, target]
    default:
      return { error: 'Unknown scan type. Use discovery, ports or service locally. vuln/intrusive/exploit moved to the Dahlia Agent via MCP network_scan.' }
  }
}

/** The nmap executable on PATH, or at its usual Windows install path, or null when it isn't installed. */
export function findNmap(): string | null {
  const candidates = process.platform === 'win32'
    ? ['nmap.exe', 'C:\\Program Files (x86)\\Nmap\\nmap.exe', 'C:\\Program Files\\Nmap\\nmap.exe']
    : ['/usr/bin/nmap', '/usr/local/bin/nmap', '/opt/homebrew/bin/nmap']
  for (const candidate of candidates) {
    if (!candidate.includes(path.sep) || existsSync(candidate))
      return candidate
  }
  return null
}

/** "22,80-82" -> [22,80,81,82]. Empty/unset -> built-in top ports. Throws on bad input or >1000 ports. */
export function parsePortList(input?: string): number[] {
  if (!input?.trim())
    return [...BUILTIN_TOP_PORTS]
  const out = new Set<number>()
  for (const part of input.split(',')) {
    const text = part.trim()
    if (!text)
      continue
    const dash = text.indexOf('-')
    if (dash < 0) {
      const port = Number(text)
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error(`Bad port "${text}".`)
      out.add(port)
    }
    else {
      const start = Number(text.slice(0, dash))
      const end = Number(text.slice(dash + 1))
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || end < start || end - start > BUILTIN_MAX_PORTS)
        throw new Error(`Bad port range "${text}".`)
      for (let port = start; port <= end; port++)
        out.add(port)
    }
    if (out.size > BUILTIN_MAX_PORTS)
      throw new Error(`Too many ports (at most ${BUILTIN_MAX_PORTS}).`)
  }
  if (out.size === 0)
    return [...BUILTIN_TOP_PORTS]
  return [...out].sort((a, b) => a - b)
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4)
    return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part))
      return null
    const byte = Number(part)
    if (byte > 255)
      return null
    value = value * 256 + byte
  }
  return value >>> 0
}

function intToIpv4(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

/** Expands one target into concrete hosts: single host/IP, CIDR (/24 etc, capped), or last-octet dash range. */
export function expandTargetHosts(target: string): string[] | { error: string } {
  const text = target.trim()
  const slash = text.indexOf('/')
  if (slash > 0) {
    const base = ipv4ToInt(text.slice(0, slash))
    const prefix = Number(text.slice(slash + 1))
    if (base === null || !Number.isInteger(prefix) || prefix < 16 || prefix > 32)
      return { error: 'The CIDR block must be IPv4 /16 to /32 (for example 192.168.10.0/24).' }
    const count = 2 ** (32 - prefix)
    if (count > BUILTIN_MAX_HOSTS + 2)
      return { error: `That block has ${count} addresses; narrow it to ${BUILTIN_MAX_HOSTS} hosts or fewer (for example a /24).` }
    const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0
    const network = (base & mask) >>> 0
    const hosts: string[] = []
    // Skip network/broadcast for prefixes smaller than /31, like nmap does.
    const first = count <= 2 ? network : network + 1
    const last = count <= 2 ? network + count - 1 : network + count - 2
    for (let ip = first; ip <= last && hosts.length < BUILTIN_MAX_HOSTS; ip++)
      hosts.push(intToIpv4(ip >>> 0))
    return hosts.length > 0 ? hosts : { error: 'That block has no usable hosts.' }
  }
  const dash = text.lastIndexOf('-')
  const dot = text.lastIndexOf('.')
  if (dash > dot && dot > 0) {
    const base = text.slice(0, dot + 1)
    const start = Number(text.slice(dot + 1, dash))
    const end = Number(text.slice(dash + 1))
    const baseInt = ipv4ToInt(`${base}0`)
    if (baseInt === null || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 255 || end < start || end - start + 1 > BUILTIN_MAX_HOSTS)
      return { error: `The range must be like 192.168.10.1-254 with at most ${BUILTIN_MAX_HOSTS} hosts.` }
    const hosts: string[] = []
    for (let octet = start; octet <= end; octet++)
      hosts.push(`${base}${octet}`)
    return hosts
  }
  return [text]
}

/** One TCP connect probe; resolves open + optional banner, never rejects. Overridable in tests. */
export function tcpProbe(host: string, port: number, timeoutMs = BUILTIN_PROBE_TIMEOUT_MS): Promise<{ open: boolean, banner?: string }> {
  return new Promise((resolve) => {
    let done = false
    let banner = ''
    const socket = new net.Socket()
    const finish = (open: boolean) => {
      if (done)
        return
      done = true
      try {
        socket.destroy()
      }
      catch {}
      resolve({ open, banner: banner.trim().slice(0, 200) || undefined })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      // Banner grab: wait briefly for any greeting, then call it open.
      const timer = setTimeout(finish, 800, true)
      socket.once('data', (chunk) => {
        banner += chunk.toString('utf8', 0, 1024)
        clearTimeout(timer)
        finish(true)
      })
      socket.once('close', () => {
        clearTimeout(timer)
        finish(true)
      })
    })
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    try {
      socket.connect(port, host)
    }
    catch {
      finish(false)
    }
    // Hard cap in case the socket hangs after connect.
    setTimeout(finish, timeoutMs + 1_000, false)
  })
}

/** Built-in discovery/ports/service scan (no nmap): TCP connect only. Heavy NSE/flag scans moved to the Agent via MCP. */
export async function builtInScan(
  hosts: string[],
  ports: number[],
  scanType: DahliaScanType,
  timeoutMs: number,
  probe: typeof tcpProbe = tcpProbe,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  const lines: string[] = []
  const servicePorts = scanType === 'discovery' ? BUILTIN_DISCOVERY_PORTS : ports

  async function probeHost(host: string): Promise<{ host: string, ip?: string, open: number[] }> {
    try {
      const resolved = await lookup(host).catch(() => undefined)
      void resolved
    }
    catch {}
    const open: number[] = []
    // Small worker pool per host keeps big ranges from opening thousands of sockets at once.
    let index = 0
    const workers = Array.from({ length: Math.min(32, servicePorts.length) }, async () => {
      while (index < servicePorts.length && Date.now() < deadline) {
        const port = servicePorts[index++]
        const result = await probe(host, port)
        if (result.open)
          open.push(port)
        if (scanType === 'discovery' && open.length > 0)
          index = servicePorts.length
      }
    })
    await Promise.all(workers)
    return { host, open: open.sort((a, b) => a - b) }
  }

  // Host-level concurrency cap for ranges.
  const results: { host: string, open: number[] }[] = []
  for (let i = 0; i < hosts.length && Date.now() < deadline; i += 16) {
    const chunk = hosts.slice(i, i + 16)
    const probed = await Promise.all(chunk.map(host => probeHost(host)))
    results.push(...probed)
  }

  for (const { host, open } of results) {
    if (scanType === 'discovery') {
      if (open.length > 0)
        lines.push(`Nmap scan report for ${host}\nHost is up (built-in TCP probe, port ${open[0]} open).`)
    }
    else if (open.length === 0) {
      lines.push(`Nmap scan report for ${host}\nHost is up but no scanned ports are open (built-in TCP connect).`)
    }
    else {
      lines.push(`Nmap scan report for ${host}\nHost is up (built-in TCP probe).\nPORT    STATE SERVICE`)
      for (const port of open)
        lines.push(`${port}/tcp  open  ${BUILTIN_SERVICE_NAMES[port] ?? 'unknown'}`)
    }
  }
  if (lines.length === 0)
    return '(no output)'
  return `${lines.join('\n')}\n[built-in scanner: nmap not installed, TCP connect only; install nmap for versions and vuln scripts]`
}

/** URL of the Dahlia Agent MCP server (heavy scans run there via MCP). Env override for tests/hosts. */
export function dahliaAgentMcpUrl(): string | null {
  const fromEnv = (process.env.DAHLIA_AGENT_MCP_URL ?? '').trim()
  if (fromEnv)
    return fromEnv.replace(/\/+$/, '')
  return null
}

/** Heavy scans belong on the Agent (vuln/intrusive/exploit NSE or raw-packet syn probes). Light scans stay local for SSH/tasks. */
export function isAgentHeavyScan(request: DahliaNetworkScanRequest): boolean {
  const scanType = request.scanType ?? 'ports'
  const connectType = request.connectType ?? 'full'
  return scanType === 'vuln' || scanType === 'intrusive' || scanType === 'exploit' || connectType !== 'full'
}

/** Calls the Dahlia Agent MCP server (initialize + tools/call network_scan) and returns its report. */
export async function runAgentNetworkScanViaMcp(
  request: DahliaNetworkScanRequest,
  mcpUrl: string,
  fetchFn: typeof fetch = fetch,
  _timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DahliaNetworkScanResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }
  const initRes = await fetchFn(`${mcpUrl.replace(/\/+$/, '')}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dahlia-app', version: '1' } }, id: 1 }),
  })
  if (!initRes.ok)
    throw new Error(`Dahlia Agent MCP did not answer initialize (${initRes.status}) at ${mcpUrl}`)
  const session = initRes.headers.get('mcp-session-id') ?? ''
  const initJson = await initRes.json() as { result?: unknown, error?: { message?: string } }
  if (!initJson.result)
    throw new Error(`Dahlia Agent MCP error: ${initJson.error?.message ?? 'no result'} `)
  const sidHeaders: Record<string, string> = { ...headers, ...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': '2025-06-18' } : {}) }
  const callRes = await fetchFn(`${mcpUrl.replace(/\/+$/, '')}`, {
    method: 'POST',
    headers: sidHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'network_scan', arguments: { target: request.target, scanType: request.scanType ?? 'ports', ports: request.ports, connectType: request.connectType ?? 'full', allowIntrusive: request.allowIntrusive ?? false, timeoutSeconds: request.timeoutSeconds } }, id: 2 }),
  })
  if (!callRes.ok)
    throw new Error(`Dahlia Agent MCP call failed (${callRes.status})`)
  const callJson = await callRes.json() as { result?: { content?: Array<{ text?: string }>, isError?: boolean }, error?: { message?: string } }
  if (callJson.error)
    throw new Error(`Dahlia Agent MCP error: ${callJson.error.message}`)
  const text = (callJson.result?.content ?? []).map(part => part.text ?? '').join('\n')
  const isError = callJson.result?.isError ?? false
  const output = text.length > DAHLIA_NETWORK_SCAN_MAX_OUTPUT ? `${text.slice(0, DAHLIA_NETWORK_SCAN_MAX_OUTPUT)}\n[cut: the report was longer]` : text || '(no output)'
  return { ok: !isError, exitCode: isError ? 1 : 0, output: `${output}\n[via Dahlia Agent MCP ${mcpUrl}]`, timedOut: false }
}

/** Runs nmap when installed, else a built-in TCP connect (full) scanner for discovery/ports/service. Heavy scans go to the Dahlia Agent via MCP first. */
export function runDahliaNetworkScan(
  request: DahliaNetworkScanRequest,
  start: (file: string, args: string[]) => ChildProcessWithoutNullStreams = (file, args) => spawn(file, args, { windowsHide: true, cwd: os.homedir() }),
  stop: (child: ChildProcessWithoutNullStreams) => void = stopTree,
  nmap: () => string | null = findNmap,
  probe: typeof tcpProbe = tcpProbe,
  agentUrl: string | null | undefined = dahliaAgentMcpUrl(),
  agentCall: typeof runAgentNetworkScanViaMcp = runAgentNetworkScanViaMcp,
): Promise<DahliaNetworkScanResult> {
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(5_000, (Number(request.timeoutSeconds) || DEFAULT_TIMEOUT_MS / 1000) * 1000))

  // Heavy scans live on the Dahlia Agent via MCP ONLY (no local NSE/raw-packet execution).
  // Light scans (discovery/ports/service full) stay local for SSH and network tasks.
  if (isAgentHeavyScan(request)) {
    if (!agentUrl)
      return Promise.resolve({ ok: false, exitCode: null, output: 'Heavy scans (vuln/intrusive/exploit, syn/syn-fin/syn-rst) moved to the Dahlia Agent: Dahlia runs them via MCP network_scan on the Agent, not locally. Configure DAHLIA_AGENT_MCP_URL.', timedOut: false })
    return agentCall(request, agentUrl).catch((error: unknown) => {
      const reason = errorMessageFrom(error) ?? String(error)
      return { ok: false, exitCode: null, output: `Dahlia Agent MCP failed (${reason}). Heavy scans run on the Agent only; no local NSE execution.`, timedOut: false }
    })
  }

  const args = scanArguments(request)
  if (!Array.isArray(args))
    return Promise.resolve({ ok: false, exitCode: null, output: args.error, timedOut: false })

  const file = nmap()
  if (!file) {
    // Heavy scans never reach here (routed to the Agent above with no local fallback).
    const scanType = request.scanType ?? 'ports'
    // No separate install needed for the basics: TCP connect in this process.
    return (async () => {
      const target = request.target?.trim() ?? ''
      const hosts = expandTargetHosts(target)
      if (!Array.isArray(hosts))
        return { ok: false, exitCode: null, output: hosts.error, timedOut: false }
      let ports: number[]
      try {
        ports = scanType === 'discovery' ? BUILTIN_DISCOVERY_PORTS : parsePortList(request.ports)
      }
      catch (error) {
        return { ok: false, exitCode: null, output: (error as Error).message, timedOut: false }
      }
      const startedAt = Date.now()
      const output = await builtInScan(hosts, ports, scanType, timeoutMs, probe)
      const clipped = output.length > DAHLIA_NETWORK_SCAN_MAX_OUTPUT
        ? `${output.slice(0, DAHLIA_NETWORK_SCAN_MAX_OUTPUT)}\n[cut: the report was longer]`
        : output
      const timedOut = Date.now() - startedAt >= timeoutMs
      return {
        ok: !timedOut,
        exitCode: 0,
        output: timedOut ? `${clipped}\n[stopped after ${Math.round(timeoutMs / 1000)} seconds]` : clipped,
        timedOut,
      }
    })()
  }
  return new Promise((resolve) => {
    let output = ''
    let cut = false
    let timedOut = false
    const add = (chunk: unknown) => {
      if (cut)
        return
      output += String(chunk)
      if (output.length > DAHLIA_NETWORK_SCAN_MAX_OUTPUT) {
        output = output.slice(0, DAHLIA_NETWORK_SCAN_MAX_OUTPUT)
        cut = true
      }
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = start(file, args)
    }
    catch (error) {
      resolve({ ok: false, exitCode: null, output: `nmap couldn't start: ${(error as Error).message}`, timedOut: false })
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
      resolve({ ok: false, exitCode: null, output: `nmap couldn't start: ${error.message}`, timedOut: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      let text = output.trimEnd()
      if (cut)
        text += '\n[cut: the report was longer]'
      if (timedOut)
        text += `\n[stopped after ${Math.round(timeoutMs / 1000)} seconds]`
      resolve({ ok: !timedOut && code === 0, exitCode: code, output: text || '(no output)', timedOut })
    })
  })
}

/** Ends nmap and what it started. */
function stopTree(child: ChildProcessWithoutNullStreams) {
  if (process.platform === 'win32' && child.pid)
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else
    child.kill()
}

/** Answers "dahlia:network-scan" requests. */
export function setupDahliaNetworkScan() {
  ipcMain.handle(DAHLIA_NETWORK_SCAN_CHANNEL, (_event, request: DahliaNetworkScanRequest) => runDahliaNetworkScan(request))
}
