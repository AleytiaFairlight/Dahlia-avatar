// Dahlia: the Kirie host (Godot) owns Dahlia's vision and game capabilities (the window
// helper, screen capture, scene model files, game launcher), reached here through Eventa
// instead of Electron's window.electron.ipcRenderer. The ids mirror AiriDesktopEvents in
// src-godot/scripts/AiriDesktopContracts.cs and DahliaEvents in
// src-godot/scripts/dahlia-contracts.cs. This file is Dahlia's (AIRI has no such file).

import { defineInvokeEventa } from '@moeru/eventa'

/** The request the renderer stringifies: {op, ...fields}, like Electron's IPC payloads. */
export interface DahliaHostCallRequest {
  json: string
}

/** The host's answer, stringified: {ok: true, ...} or {ok: false, error}. */
export interface DahliaHostCallAnswer {
  json: string
}

export const dahliaWindowCall = defineInvokeEventa<DahliaHostCallAnswer, DahliaHostCallRequest>('eventa:invoke:dahlia:window:call')
export const dahliaScreenCall = defineInvokeEventa<DahliaHostCallAnswer, DahliaHostCallRequest>('eventa:invoke:dahlia:screen:call')
export const dahliaSceneCall = defineInvokeEventa<DahliaHostCallAnswer, DahliaHostCallRequest>('eventa:invoke:dahlia:scene:call')
export const dahliaGameLauncherCall = defineInvokeEventa<DahliaHostCallAnswer, DahliaHostCallRequest>('eventa:invoke:dahlia:game-launcher:call')

// Dahlia: her ticket-workflow browser steps (workflow_* tools and the Tickets
// sign-in), answered by the Godot host (src-godot/scripts/dahlia-workflow-browser.cs).
// Like vision and game, one flat JSON request ({op, ...fields}) and one flat
// JSON answer ({ok: true, ...} or {ok: false, error}).
export const dahliaWorkflowCall = defineInvokeEventa<DahliaHostCallAnswer, DahliaHostCallRequest>('eventa:invoke:dahlia:workflow:call')

// Dahlia: her system tools on this PC, answered by the Godot host
// (src-godot/scripts/dahlia-*-service.cs, wired in Main.cs). The ported
// renderer modules reach them through renderer/dahlia-host.ts, which keeps
// every other dahlia:* channel for the areas that own them. The ids mirror
// DahliaEvents in src-godot/scripts/dahlia-contracts.cs.

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

export const dahliaRunPowerShell = defineInvokeEventa<DahliaPowerShellResult, DahliaPowerShellRequest>('eventa:invoke:dahlia:powershell:run')
export const dahliaGetHostName = defineInvokeEventa<string, Record<string, never>>('eventa:invoke:dahlia:host-name:get')

export interface DahliaErrorReport {
  kind: string
  message: string
  stack?: string
  source: string
  page?: string
  platform?: string
  time: number
}

export interface DahliaErrorSourceResult {
  appVersion?: string
  reports: DahliaErrorReport[]
}

/** The host's queued errors (dahlia-error-reports.cs, answered in AiriDesktopEvents). */
export const dahliaTakeErrorReports = defineInvokeEventa<DahliaErrorSourceResult, Record<string, never>>('eventa:invoke:dahlia:error-reports:take')

export interface DahliaPcState {
  app: string
  title: string
  own: boolean
  idleSeconds: number
  cpu?: number
  memory: number
  gpu?: number
  volume?: number
  muted?: boolean
}

export const dahliaGetPcState = defineInvokeEventa<DahliaPcState, Record<string, never>>('eventa:invoke:dahlia:pc-state:get')

// Dahlia: her ghost cursor (backseat pointing), answered by the Godot host
// (src-godot/scripts/dahlia-ghost-cursor.cs). The request is physical screen
// pixels; the host shows the pointer there for a while.
export interface DahliaGhostCursorRequest {
  x: number
  y: number
  label?: string
  ms?: number
}

export interface DahliaGhostCursorResult {
  ok: boolean
  error?: string
}

export const dahliaShowGhostCursor = defineInvokeEventa<DahliaGhostCursorResult, DahliaGhostCursorRequest>('eventa:invoke:dahlia:ghost-cursor:show')

// Dahlia: her local network scans (network_scan tool), answered by the Godot
// host (src-godot/scripts/dahlia-network-scan.cs): nmap when installed, else a
// built-in full-TCP scanner. Heavy scans are refused with where to run them.
export interface DahliaNetworkScanRequest {
  target: string
  scanType?: string
  ports?: string
  connectType?: string
  allowIntrusive?: boolean
  timeoutSeconds?: number
}

export interface DahliaNetworkScanResult {
  ok: boolean
  exitCode: number | null
  output: string
  timedOut: boolean
}

export const dahliaRunNetworkScan = defineInvokeEventa<DahliaNetworkScanResult, DahliaNetworkScanRequest>('eventa:invoke:dahlia:network-scan:run')

// Dahlia: SSH from this PC (ssh tools and Settings > Dahlia > SSH), answered
// by the Godot host (src-godot/scripts/dahlia-ssh.cs) through the system's
// OpenSSH client. A password goes in, never out.
export interface DahliaSshRequest {
  op: string
  host?: string
  user?: string
  port?: number
  command?: string
  password?: string
  timeoutSeconds?: number
  target?: string
}

export interface DahliaSshResult {
  ok: boolean
  exitCode: number | null
  output: string
}

export const dahliaRunSsh = defineInvokeEventa<DahliaSshResult, DahliaSshRequest>('eventa:invoke:dahlia:ssh:run')

export interface DahliaSshKnownHost {
  host: string
  fingerprint: string
}

export interface DahliaSshSettings {
  publicKey?: string
  keyFile: string
  passwords: string[]
  hosts: DahliaSshKnownHost[]
  canSavePasswords: boolean
}

export const dahliaGetSshSettings = defineInvokeEventa<DahliaSshSettings, DahliaSshRequest>('eventa:invoke:dahlia:ssh-settings:get')
