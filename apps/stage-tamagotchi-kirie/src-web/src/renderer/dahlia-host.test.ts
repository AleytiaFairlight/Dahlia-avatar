// Dahlia: the host adapter routes her system tools to the Godot host's Eventa
// invokes, and keeps every other dahlia:* channel rejecting for the areas
// that own them.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dahliaGetHostName, dahliaGetPcState, dahliaGetSshSettings, dahliaRunNetworkScan, dahliaRunPowerShell, dahliaRunSsh, dahliaShowGhostCursor, dahliaTakeErrorReports, dahliaWorkflowCall } from '../shared/eventa/dahlia'

import { dahliaHostInvoke } from './dahlia-host'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@moeru/eventa', async (importOriginal) => {
  const original = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...original,
    defineInvoke: (_context: unknown, event: { sendEvent: { id: string } }) => {
      return (...args: unknown[]) => invoke(event.sendEvent.id, ...args)
    },
  }
})

vi.mock('./host-context/owner', () => ({
  initializeHostContext: () => ({
    context: {},
  }),
}))

describe('dahlia host', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('runs PowerShell through the host invoke', async () => {
    invoke.mockResolvedValue({ ok: true, exitCode: 0, output: 'hi', timedOut: false })

    await expect(dahliaHostInvoke('dahlia:powershell', { command: 'Get-Date', timeoutSeconds: 10 }))
      .resolves.toEqual({ ok: true, exitCode: 0, output: 'hi', timedOut: false })
    expect(invoke).toHaveBeenCalledWith(dahliaRunPowerShell.sendEvent.id, { command: 'Get-Date', timeoutSeconds: 10 })
  })

  it('reads the host name and the PC state without a request', async () => {
    invoke.mockResolvedValueOnce('kirie-pc')
    await expect(dahliaHostInvoke('dahlia:host-name')).resolves.toBe('kirie-pc')
    expect(invoke).toHaveBeenLastCalledWith(dahliaGetHostName.sendEvent.id, {})

    const sample = { app: '', title: '', own: false, idleSeconds: 0, memory: 0 }
    invoke.mockResolvedValueOnce(sample)
    await expect(dahliaHostInvoke('dahlia:pc-state')).resolves.toBe(sample)
    expect(invoke).toHaveBeenLastCalledWith(dahliaGetPcState.sendEvent.id, {})
  })

  it('takes error reports through the host invoke', async () => {
    const payload = { appVersion: '1.0.0', reports: [] }
    invoke.mockResolvedValueOnce(payload)
    await expect(dahliaHostInvoke('dahlia:error-reports:take')).resolves.toBe(payload)
    expect(invoke).toHaveBeenLastCalledWith(dahliaTakeErrorReports.sendEvent.id, {})
  })

  it('routes ghost cursor, network scans, SSH and workflow through the host invokes', async () => {
    invoke.mockResolvedValueOnce({ ok: true })
    await expect(dahliaHostInvoke('dahlia:ghost-cursor', { x: 10, y: 20, label: 'here', ms: 7000 }))
      .resolves.toEqual({ ok: true })
    expect(invoke).toHaveBeenLastCalledWith(dahliaShowGhostCursor.sendEvent.id, { x: 10, y: 20, label: 'here', ms: 7000 })

    const scan = { ok: true, exitCode: 0, output: 'report', timedOut: false }
    invoke.mockResolvedValueOnce(scan)
    await expect(dahliaHostInvoke('dahlia:network-scan', { target: '192.168.1.0/24' }))
      .resolves.toBe(scan)
    expect(invoke).toHaveBeenLastCalledWith(dahliaRunNetworkScan.sendEvent.id, {
      target: '192.168.1.0/24',
      scanType: undefined,
      ports: undefined,
      connectType: undefined,
      allowIntrusive: undefined,
      timeoutSeconds: undefined,
    })

    const ssh = { ok: true, exitCode: 0, output: 'aleytia\n' }
    invoke.mockResolvedValueOnce(ssh)
    await expect(dahliaHostInvoke('dahlia:ssh', { op: 'run', host: 'nas', user: 'root', command: 'whoami' }))
      .resolves.toBe(ssh)
    expect(invoke).toHaveBeenLastCalledWith(dahliaRunSsh.sendEvent.id, {
      op: 'run',
      host: 'nas',
      user: 'root',
      port: undefined,
      command: 'whoami',
      password: undefined,
      timeoutSeconds: undefined,
      target: undefined,
    })

    const settings = { keyFile: 'id_ed25519', passwords: [], hosts: [], canSavePasswords: false }
    invoke.mockResolvedValueOnce(settings)
    await expect(dahliaHostInvoke('dahlia:ssh-settings', { op: 'list' }))
      .resolves.toBe(settings)
    expect(invoke).toHaveBeenLastCalledWith(dahliaGetSshSettings.sendEvent.id, {
      op: 'list',
      host: undefined,
      user: undefined,
      port: undefined,
      password: undefined,
      target: undefined,
    })

    invoke.mockResolvedValueOnce({ json: JSON.stringify({ ok: true, answer: { items: [] } }) })
    await expect(dahliaHostInvoke('dahlia:workflow', { op: 'mail_list' }))
      .resolves.toEqual({ ok: true, answer: { items: [] } })
    expect(invoke).toHaveBeenLastCalledWith(dahliaWorkflowCall.sendEvent.id, { json: JSON.stringify({ op: 'mail_list' }) })
  })

  it('rejects channels other areas own', async () => {
    await expect(dahliaHostInvoke('dahlia:video-call', {}))
      .rejects.toThrow('dahlia:video-call')
    expect(invoke).not.toHaveBeenCalled()
  })
})
