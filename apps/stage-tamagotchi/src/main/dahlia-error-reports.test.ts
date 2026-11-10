import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (...args: any[]) => void>()
  const handlers = new Map<string, () => unknown>()
  return {
    listeners,
    handlers,
    paths: { userData: '', crashDumps: '' },
    app: {
      getPath: (name: 'userData' | 'crashDumps') => electron.paths[name],
      getVersion: () => '0.12.2-beta.6',
      on: (event: string, listener: (...args: any[]) => void) => listeners.set(event, listener),
      whenReady: () => Promise.resolve(),
    },
    crashReporter: { start: vi.fn() },
    ipcMain: { handle: (channel: string, handler: () => unknown) => handlers.set(channel, handler) },
  }
})

vi.mock('electron', () => ({ app: electron.app, crashReporter: electron.crashReporter, ipcMain: electron.ipcMain }))

const { DAHLIA_ERROR_REPORTS_CHANNEL, queueDahliaErrorReport, setupDahliaErrorReports } = await import('./dahlia-error-reports')

describe('dahlia error reports (main process)', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dahlia-errors-'))
    electron.paths.userData = dir
    electron.paths.crashDumps = join(dir, 'Crashpad')
    mkdirSync(join(electron.paths.crashDumps, 'reports'), { recursive: true })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps crashed processes and new crash dumps until a window takes them, without uploading dumps', async () => {
    writeFileSync(join(electron.paths.crashDumps, 'reports', 'a1.dmp'), 'x'.repeat(3000))
    setupDahliaErrorReports()
    await Promise.resolve()
    await Promise.resolve()

    expect(electron.crashReporter.start).toHaveBeenCalledWith({ uploadToServer: false })
    electron.listeners.get('render-process-gone')!({}, { getURL: () => 'app://index.html#/chat?code=secret' }, { reason: 'crashed', exitCode: 5 })
    electron.listeners.get('render-process-gone')!({}, { getURL: () => 'app://index.html' }, { reason: 'clean-exit', exitCode: 0 })
    electron.listeners.get('child-process-gone')!({}, { type: 'GPU', reason: 'oom', exitCode: -1 })
    queueDahliaErrorReport({ kind: 'main-uncaught', source: 'main', message: 'Error: boom' })

    const take = electron.handlers.get(DAHLIA_ERROR_REPORTS_CHANNEL)!
    const first = take() as { appVersion: string, reports: Array<{ kind: string, message: string, page?: string }> }
    expect(first.appVersion).toBe('0.12.2-beta.6')
    expect(first.reports.map(r => r.kind)).toEqual(['native-crash', 'renderer-gone', 'process-gone', 'main-uncaught'])
    expect(first.reports[0].message).toContain('a1.dmp')
    expect(first.reports[1].page).toBe('#/chat')
    expect(first.reports[2].message).toBe('The GPU process stopped: oom (exit code -1)')

    expect((take() as { reports: unknown[] }).reports).toEqual([])
  })
})
