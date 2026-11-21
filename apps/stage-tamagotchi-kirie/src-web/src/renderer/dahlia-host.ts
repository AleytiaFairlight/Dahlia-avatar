// Dahlia: the Kirie host (Godot) answers her system tools through Eventa
// (src-godot/scripts/dahlia-*-service.cs, wired in Main.cs). This adapter is
// the single place the ported renderer modules ask for them, so each channel
// they call maps to one host invoke here. Channels for other areas (network,
// updates, ...) still reject until those areas port their own capabilities;
// vision and game (window, screen, scene, game-launcher), her ghost cursor,
// network scans, SSH and the ticket-workflow browser are routed below.

import type { InvokeEventa } from '@moeru/eventa'

import { defineInvoke } from '@moeru/eventa'

import { dahliaGetHostName, dahliaGetPcState, dahliaGetSshSettings, dahliaRunNetworkScan, dahliaRunPowerShell, dahliaRunSsh, dahliaShowGhostCursor, dahliaTakeErrorReports } from '../shared/eventa/dahlia'
import { dahliaGameLauncherCall, dahliaSceneCall, dahliaScreenCall, dahliaWindowCall, dahliaWorkflowCall } from '../shared/eventa/dahlia'
import type { DahliaHostCallAnswer, DahliaHostCallRequest } from '../shared/eventa/dahlia'

import { initializeHostContext } from './host-context/owner'

type DahliaCall = InvokeEventa<DahliaHostCallAnswer, DahliaHostCallRequest>

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

/**
 * Eventa carries JSON, not bytes: pictures and recordings travel as base64 strings.
 * (Electron's IPC carried Uint8Array natively; the renderer ports keep passing bytes
 * and this encodes them, so the host always sees a base64 string.)
 */
function encodeRequest(value: unknown): unknown {
  if (value instanceof Uint8Array)
    return base64FromBytes(value)
  if (Array.isArray(value))
    return value.map(encodeRequest)
  if (value && typeof value === 'object') {
    const encoded: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>))
      encoded[key] = encodeRequest(entry)
    return encoded
  }
  return value
}

async function callHost(call: DahliaCall, request: Record<string, unknown>): Promise<Record<string, any>> {
  const invoke = defineInvoke(initializeHostContext().context, call)
  const answer = await invoke({ json: JSON.stringify(encodeRequest(request)) })
  const parsed = JSON.parse(answer.json) as { ok?: boolean, error?: string, [field: string]: unknown }
  if (!parsed || parsed.ok !== true)
    throw new Error(typeof parsed?.error === 'string' && parsed.error ? parsed.error : 'The host request failed.')
  return parsed
}

/** A request to the host's window helper (find/capture/tap/swipe/key/show/foreground/read-text/frame/peek/watch-events/watch-stop/system). */
export async function dahliaWindow(request: Record<string, unknown>): Promise<Record<string, any>> {
  return await callHost(dahliaWindowCall, request)
}

/** A request to the host's screen capture (screenshot/record-source/record-done/save-recording/save-picture). */
export async function dahliaScreen(request: Record<string, unknown>): Promise<Record<string, any>> {
  return await callHost(dahliaScreenCall, request)
}

/** A request to the host's scene model files (status/install/describe). */
export async function dahliaScene(request: Record<string, unknown>): Promise<Record<string, any>> {
  return await callHost(dahliaSceneCall, request)
}

/** A request to the host's game launcher (find/launch). */
export async function dahliaGameLauncher(request: Record<string, unknown>): Promise<Record<string, any>> {
  return await callHost(dahliaGameLauncherCall, request)
}

/** A request to the host's ticket-workflow browser (signin/mail_list/mail_open/ticket_read/ticket_note). */
export async function dahliaWorkflow(request: Record<string, unknown>): Promise<Record<string, any>> {
  return await callHost(dahliaWorkflowCall, request)
}

/** A request to the Kirie host's Dahlia channels (typed invokes and flat host calls above). */
export async function dahliaHostInvoke<T>(channel: string, request?: Record<string, unknown>): Promise<T> {
  const host = initializeHostContext()
  switch (channel) {
    // PowerShell on this PC (dahlia-powershell-service.cs, Windows only).
    case 'dahlia:powershell': {
      const run = defineInvoke(host.context, dahliaRunPowerShell)
      return await run({
        command: typeof request?.command === 'string' ? request.command : '',
        timeoutSeconds: typeof request?.timeoutSeconds === 'number' ? request.timeoutSeconds : undefined,
      }) as T
    }
    // The PC's host name (dahlia-device-service.cs).
    case 'dahlia:host-name': {
      return await defineInvoke(host.context, dahliaGetHostName)({}) as T
    }
    // The host's queued errors (dahlia-error-reports.cs, via AiriDesktopEvents).
    case 'dahlia:error-reports:take': {
      return await defineInvoke(host.context, dahliaTakeErrorReports)({}) as T
    }
    // What this PC knows about what its person is doing (dahlia-pc-state-service.cs).
    case 'dahlia:pc-state': {
      return await defineInvoke(host.context, dahliaGetPcState)({}) as T
    }
    // Her ghost cursor (dahlia-ghost-cursor.cs): where she points on the screen.
    case 'dahlia:ghost-cursor': {
      const show = defineInvoke(host.context, dahliaShowGhostCursor)
      return await show({
        x: typeof request?.x === 'number' ? request.x : Number.NaN,
        y: typeof request?.y === 'number' ? request.y : Number.NaN,
        label: typeof request?.label === 'string' ? request.label : undefined,
        ms: typeof request?.ms === 'number' ? request.ms : undefined,
      }) as T
    }
    // Local network scans (dahlia-network-scan.cs): nmap when installed,
    // else the built-in TCP scanner; heavy scans are refused with where to run them.
    case 'dahlia:network-scan': {
      const scan = defineInvoke(host.context, dahliaRunNetworkScan)
      return await scan({
        target: typeof request?.target === 'string' ? request.target : '',
        scanType: typeof request?.scanType === 'string' ? request.scanType : undefined,
        ports: typeof request?.ports === 'string' ? request.ports : undefined,
        connectType: typeof request?.connectType === 'string' ? request.connectType : undefined,
        allowIntrusive: typeof request?.allowIntrusive === 'boolean' ? request.allowIntrusive : undefined,
        timeoutSeconds: typeof request?.timeoutSeconds === 'number' ? request.timeoutSeconds : undefined,
      }) as T
    }
    // SSH from this PC (dahlia-ssh.cs), through the system's OpenSSH client.
    case 'dahlia:ssh': {
      const ssh = defineInvoke(host.context, dahliaRunSsh)
      return await ssh({
        op: typeof request?.op === 'string' ? request.op : '',
        host: typeof request?.host === 'string' ? request.host : undefined,
        user: typeof request?.user === 'string' ? request.user : undefined,
        port: typeof request?.port === 'number' ? request.port : undefined,
        command: typeof request?.command === 'string' ? request.command : undefined,
        password: typeof request?.password === 'string' ? request.password : undefined,
        timeoutSeconds: typeof request?.timeoutSeconds === 'number' ? request.timeoutSeconds : undefined,
        target: typeof request?.target === 'string' ? request.target : undefined,
      }) as T
    }
    // Settings > Dahlia > SSH (dahlia-ssh.cs). A password goes in, never out.
    case 'dahlia:ssh-settings': {
      const settings = defineInvoke(host.context, dahliaGetSshSettings)
      return await settings({
        op: typeof request?.op === 'string' ? request.op : 'list',
        host: typeof request?.host === 'string' ? request.host : undefined,
        user: typeof request?.user === 'string' ? request.user : undefined,
        port: typeof request?.port === 'number' ? request.port : undefined,
        password: typeof request?.password === 'string' ? request.password : undefined,
        target: typeof request?.target === 'string' ? request.target : undefined,
      }) as T
    }
    // Her ticket-workflow browser steps (dahlia-workflow-browser.cs).
    case 'dahlia:workflow': {
      return await dahliaWorkflow(request ?? {}) as T
    }
    // Her game window (dahlia-window-helper.cs, Windows only).
    case 'dahlia:window': {
      return await dahliaWindow(request ?? {}) as T
    }
    // Screenshots of this PC (dahlia-screen-capture.cs, Windows only).
    case 'dahlia:screen': {
      return await dahliaScreen(request ?? {}) as T
    }
    // The scene model files (dahlia-scene-model.cs).
    case 'dahlia:scene': {
      return await dahliaScene(request ?? {}) as T
    }
    // Finding and starting games (dahlia-game-launcher.cs, Windows only).
    case 'dahlia:game-launcher': {
      return await dahliaGameLauncher(request ?? {}) as T
    }
    default:
      throw new Error(`This host can't do that yet (${channel} isn't a Kirie capability).`)
  }
}
