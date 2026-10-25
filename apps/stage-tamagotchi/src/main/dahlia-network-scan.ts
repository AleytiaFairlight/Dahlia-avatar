// Dahlia: runs nmap scans for Dahlia, when she is asked from the user's other devices (the "network_scan"
// tool of src/renderer/dahlia-remote-tools.ts), on the "dahlia:network-scan" channel. For a security
// professional auditing their own and their engagements' networks: host discovery, open ports, service and
// version detection, and the NSE "vuln" detection category. The nmap arguments are built here from a flag
// allowlist (recon and detection, not exploit launching or denial of service); widen it by editing this file.
// This file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls setupDahliaNetworkScan()
// when the main process starts.

import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

import { ipcMain } from 'electron'

export const DAHLIA_NETWORK_SCAN_CHANNEL = 'dahlia:network-scan'
export const DAHLIA_NETWORK_SCAN_MAX_OUTPUT = 24_000
const DEFAULT_TIMEOUT_MS = 180_000
const MAX_TIMEOUT_MS = 900_000

export type DahliaScanType = 'discovery' | 'ports' | 'service' | 'vuln'

export interface DahliaNetworkScanRequest {
  /** What to scan: a host name, an IPv4 address, a CIDR block, or a dash range (e.g. 192.168.10.1-254). */
  target: string
  /** discovery: which hosts are up. ports: which TCP ports are open. service: service and version. vuln: known-vulnerability detection. */
  scanType?: DahliaScanType
  /** The TCP ports, as nmap's -p takes them (e.g. "22,80,443" or "1-1024"). The default is nmap's top ports. */
  ports?: string
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

/** The nmap flags for each scan type: recon and detection only, never exploit or denial-of-service scripts. */
export function scanArguments(request: DahliaNetworkScanRequest): string[] | { error: string } {
  const target = request.target?.trim() ?? ''
  if (!TARGET.test(target))
    return { error: 'The target must be a host name, an IP address, a CIDR block, or a dash range (for example 192.168.10.0/24).' }
  if (request.ports !== undefined && !PORTS.test(request.ports.trim()))
    return { error: 'The ports must be numbers, commas and dashes, as nmap\'s -p takes them (for example 22,80,443).' }

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
    case 'vuln':
      // The NSE "vuln" category detects known vulnerabilities; it does not run exploit or dos scripts.
      return ['-sT', '-sV', '-Pn', '--script', 'vuln', ...ports, ...common, target]
    default:
      return { error: 'Unknown scan type. Use discovery, ports, service or vuln.' }
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

/** Runs nmap and collects its output, cut at the limit, until it ends or the time is up. */
export function runDahliaNetworkScan(
  request: DahliaNetworkScanRequest,
  start: (file: string, args: string[]) => ChildProcessWithoutNullStreams = (file, args) => spawn(file, args, { windowsHide: true, cwd: os.homedir() }),
  stop: (child: ChildProcessWithoutNullStreams) => void = stopTree,
  nmap: () => string | null = findNmap,
): Promise<DahliaNetworkScanResult> {
  const file = nmap()
  if (!file) {
    return Promise.resolve({
      ok: false,
      exitCode: null,
      output: 'nmap is not installed on this PC. Install it (on Windows: `winget install Insecure.Nmap`), then try again.',
      timedOut: false,
    })
  }

  const args = scanArguments(request)
  if (!Array.isArray(args))
    return Promise.resolve({ ok: false, exitCode: null, output: args.error, timedOut: false })

  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(5_000, (Number(request.timeoutSeconds) || DEFAULT_TIMEOUT_MS / 1000) * 1000))
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
