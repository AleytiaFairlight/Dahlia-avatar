import process from 'node:process'

// Dahlia: what the desktop app's windows can't report themselves, for the error log on Dahlia's server
// (stage-ui libs/dahlia-error-reports.ts sends it): errors that reach the top of the main process, windows and
// helper processes (GPU, utility) that crashed, and native crash dumps Electron's crash reporter saved, also from a
// run that crashed. They wait in a file in the app's data folder until a window takes them. Nothing goes to Sentry.
// This file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls setupDahliaErrorReports()
// when the main process starts.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { app, crashReporter, ipcMain } from 'electron'

export const DAHLIA_ERROR_REPORTS_CHANNEL = 'dahlia:error-reports:take'

/** The pending reports are dropped beyond this size; a window takes them every few minutes. */
const MAX_PENDING_BYTES = 512 * 1024

interface PendingReport {
  kind: string
  message: string
  stack?: string
  source: string
  page?: string
  platform: string
  time: number
}

function pendingFile() {
  return join(app.getPath('userData'), 'dahlia-error-reports.jsonl')
}

function seenDumpsFile() {
  return join(app.getPath('userData'), 'dahlia-crash-dumps-seen.txt')
}

/** Appends one report at once, so a report written while the process dies isn't lost. */
export function queueDahliaErrorReport(report: Omit<PendingReport, 'platform' | 'time'> & { time?: number }) {
  try {
    const file = pendingFile()
    if (existsSync(file) && statSync(file).size > MAX_PENDING_BYTES)
      return
    appendFileSync(file, `${JSON.stringify({ platform: process.platform, time: Date.now(), ...report })}\n`)
  }
  catch {
    // Nowhere to report a failed report.
  }
}

function errorText(error: unknown) {
  return error instanceof Error
    ? { message: `${error.name}: ${error.message}`, stack: error.stack }
    : { message: String(error) }
}

function routeOf(url: string) {
  try {
    const parsed = new URL(url)
    // The route of the window; a file: page's path would also show where the app is installed.
    return parsed.hash.split('?')[0] || basename(parsed.pathname) || undefined
  }
  catch {
    return undefined
  }
}

function dumpsIn(dir: string, depth = 0): string[] {
  if (depth > 3 || !existsSync(dir))
    return []
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      found.push(...dumpsIn(path, depth + 1))
    else if (entry.name.endsWith('.dmp'))
      found.push(path)
  }
  return found
}

/** Reports the crash dumps that are new since the last start; the dumps themselves stay on the PC. */
function reportNewCrashDumps() {
  try {
    const seenFile = seenDumpsFile()
    const seen = new Set(existsSync(seenFile) ? readFileSync(seenFile, 'utf8').split('\n').filter(Boolean) : [])
    const dumps = dumpsIn(app.getPath('crashDumps'))
    for (const dump of dumps) {
      if (seen.has(basename(dump)))
        continue
      const info = statSync(dump)
      queueDahliaErrorReport({
        kind: 'native-crash',
        source: 'crash-reporter',
        message: `The app crashed (native crash dump ${basename(dump)}, ${Math.ceil(info.size / 1024)} KB, kept on this PC in ${app.getPath('crashDumps')})`,
        time: info.mtimeMs,
      })
    }
    writeFileSync(seenFile, dumps.map(dump => basename(dump)).join('\n'))
  }
  catch (error) {
    console.warn('[dahlia-error-reports] Could not read the crash dumps:', error)
  }
}

export function setupDahliaErrorReports() {
  // Saves native crash dumps on this PC only. They used to go to AIRI's Sentry; the next start reports them to Dahlia.
  crashReporter.start({ uploadToServer: false })

  // Observes without changing what an uncaught error does (Electron's own handling still runs).
  process.on('uncaughtExceptionMonitor', (error, origin) =>
    queueDahliaErrorReport({ kind: origin === 'unhandledRejection' ? 'main-unhandledrejection' : 'main-uncaught', source: 'main', ...errorText(error) }))

  app.on('render-process-gone', (_event, contents, details) => {
    if (details.reason === 'clean-exit')
      return
    queueDahliaErrorReport({
      kind: 'renderer-gone',
      source: 'main',
      page: routeOf(contents.getURL()),
      message: `A window's page stopped: ${details.reason} (exit code ${details.exitCode})`,
    })
  })

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit')
      return
    queueDahliaErrorReport({
      kind: 'process-gone',
      source: 'main',
      message: `The ${details.type}${details.name ? ` (${details.name})` : ''} process stopped: ${details.reason} (exit code ${details.exitCode})`,
    })
  })

  app.whenReady().then(reportNewCrashDumps).catch(() => {})

  // A window takes the reports and sends them with the Dahlia key, which only the windows have.
  ipcMain.handle(DAHLIA_ERROR_REPORTS_CHANNEL, () => {
    const file = pendingFile()
    let reports: PendingReport[] = []
    try {
      if (existsSync(file)) {
        reports = readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
          try {
            return [JSON.parse(line) as PendingReport]
          }
          catch {
            return []
          }
        })
        writeFileSync(file, '')
      }
    }
    catch (error) {
      console.warn('[dahlia-error-reports] Could not read the pending reports:', error)
    }
    return { appVersion: app.getVersion(), reports }
  })
}
