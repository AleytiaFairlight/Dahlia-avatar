// Dahlia: the apps' errors and crashes go to a log file on Dahlia's server (POST /api/v1/dahlia/errors, written to
// data/logs/avatar-app-errors-*.log by the Avatar server), not to Sentry. Each window reports its script errors,
// unhandled promise rejections and the errors Vue catches. The desktop app and the Android app also register a source
// that hands over what the window itself can't see: the main process's errors and crashed processes, native crash
// dumps and Android crashes from the last run. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh starts it in each app's main.ts instead of AIRI's Sentry reports.
import type { App } from 'vue'

import { dahliaHeaders, dahliaKey } from '../stores/dahlia-auth'
import { SERVER_URL } from './server'

export interface DahliaErrorReport {
  kind: string
  message: string
  stack?: string
  /** Where it happened: the window ("renderer"), or what a source reports ("main", "android", ...). */
  source: string
  /** The window's route, without query values. */
  page?: string
  platform?: string
  appVersion?: string
  /** Milliseconds since 1970. */
  time: number
  /** How many more times the same report came within the quiet time. */
  repeats?: number
  userAgent?: string
}

/** What a platform source hands over: its reports, and the app version when it knows it. */
export interface DahliaErrorSourceResult {
  appVersion?: string
  reports: Array<Partial<DahliaErrorReport> & { message: string }>
}

export type DahliaErrorSource = () => Promise<DahliaErrorSourceResult | undefined>

export interface DahliaErrorReporterOptions {
  send: (reports: DahliaErrorReport[]) => Promise<'sent' | 'retry' | 'drop'>
  canSend?: () => boolean
  now?: () => number
  platform?: string
  userAgent?: string
  page?: () => string | undefined
}

const MAX_QUEUE = 100
const MAX_BATCH = 20
/** The same report again within this time only counts as a repeat. */
const QUIET_MS = 10 * 60_000
const FLUSH_DELAY_MS = 2_000
const RETRY_MIN_MS = 30_000
const RETRY_MAX_MS = 5 * 60_000
const SOURCE_POLL_MS = 5 * 60_000

function textOf(value: unknown): { message: string, stack?: string } {
  if (value instanceof Error)
    return { message: `${value.name}: ${value.message}`, stack: value.stack }
  if (typeof value === 'string')
    return { message: value }
  if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
    const { message, stack } = value as { message: string, stack?: unknown }
    return { message, stack: typeof stack === 'string' ? stack : undefined }
  }
  try {
    return { message: JSON.stringify(value) ?? String(value) }
  }
  catch {
    return { message: String(value) }
  }
}

function firstStackLine(stack?: string) {
  return stack?.split('\n').find(line => line.trim().startsWith('at ') || line.includes('@'))?.trim() ?? ''
}

/** Queues reports, folds repeats, and sends them in batches; a failed send is tried again later. */
export function createDahliaErrorReporter(options: DahliaErrorReporterOptions) {
  const now = options.now ?? Date.now
  const queue: DahliaErrorReport[] = []
  const recent = new Map<string, { at: number, repeats: number }>()
  let appVersion: string | undefined
  let dropped = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let retryMs = RETRY_MIN_MS
  let sending = false

  function enqueue(report: DahliaErrorReport) {
    const key = `${report.source}\n${report.kind}\n${report.message}\n${firstStackLine(report.stack)}`
    const seen = recent.get(key)
    const at = now()
    if (seen && at - seen.at < QUIET_MS) {
      seen.repeats++
      return
    }

    if (seen?.repeats)
      report.repeats = seen.repeats
    recent.set(key, { at, repeats: 0 })
    if (recent.size > 500)
      recent.delete(recent.keys().next().value!)

    if (queue.length >= MAX_QUEUE) {
      queue.shift()
      dropped++
    }
    queue.push(report)
    schedule(FLUSH_DELAY_MS)
  }

  function schedule(delay: number) {
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined
        void flush()
      }, delay)
    }
  }

  async function flush() {
    if (sending || queue.length === 0)
      return
    if (options.canSend && !options.canSend()) {
      schedule(RETRY_MIN_MS)
      return
    }

    sending = true
    const batch: DahliaErrorReport[] = queue.slice(0, MAX_BATCH).map(report => ({ ...report, appVersion: report.appVersion ?? appVersion }))
    if (dropped > 0) {
      batch.push({ kind: 'dropped', message: `${dropped} earlier error report(s) were dropped: too many waited to be sent.`, source: 'reporter', time: now(), platform: options.platform })
      dropped = 0
    }

    let result: 'sent' | 'retry' | 'drop'
    try {
      result = await options.send(batch)
    }
    catch {
      result = 'retry'
    }
    finally {
      sending = false
    }

    if (result === 'retry') {
      schedule(retryMs)
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
      return
    }

    queue.splice(0, Math.min(MAX_BATCH, queue.length))
    retryMs = RETRY_MIN_MS
    if (queue.length > 0)
      schedule(FLUSH_DELAY_MS)
  }

  function report(kind: string, error: unknown, extra: Partial<DahliaErrorReport> = {}) {
    const { message, stack } = textOf(error)
    if (!message.trim())
      return
    enqueue({
      kind,
      message,
      stack,
      source: 'renderer',
      page: options.page?.(),
      platform: options.platform,
      userAgent: options.userAgent,
      time: now(),
      ...extra,
    })
  }

  /** Takes a source's reports (the desktop main process, Android) into the queue. */
  async function takeFrom(source: DahliaErrorSource) {
    let result: DahliaErrorSourceResult | undefined
    try {
      result = await source()
    }
    catch (error) {
      console.warn('[dahlia-error-reports] A report source failed:', error)
      return
    }
    if (result?.appVersion)
      appVersion = result.appVersion
    for (const item of result?.reports ?? []) {
      if (typeof item?.message === 'string' && item.message.trim())
        enqueue({ kind: 'error', source: 'app', platform: options.platform, time: now(), ...item })
    }
  }

  function setAppVersion(version: string) {
    appVersion = version
  }

  return { report, takeFrom, flush, setAppVersion, pending: () => queue.length }
}

type DahliaErrorReporter = ReturnType<typeof createDahliaErrorReporter>

let reporter: DahliaErrorReporter | undefined
const sources: DahliaErrorSource[] = []

function platformName() {
  const g = globalThis as { electron?: unknown, navigator?: Navigator }
  if (g.electron)
    return 'desktop'
  return /Android/i.test(g.navigator?.userAgent ?? '') ? 'android' : 'web'
}

function pageName() {
  if (typeof location === 'undefined')
    return undefined
  // The route only: query values can hold codes or tokens, and a file: page's path shows where the app is installed.
  return location.hash.split('?')[0] || location.pathname.split('/').pop() || undefined
}

async function sendToDahlia(reports: DahliaErrorReport[]): Promise<'sent' | 'retry' | 'drop'> {
  const response = await globalThis.fetch.bind(globalThis)(`${SERVER_URL}/api/v1/dahlia/errors`, {
    method: 'POST',
    headers: dahliaHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reports }),
    keepalive: true,
  })
  if (response.ok)
    return 'sent'
  // A key the server doesn't know yet, a full hour or a server error: try again later. A refused body won't change.
  return response.status === 400 || response.status === 413 ? 'drop' : 'retry'
}

/** Reports a caught error that a feature wants in the log. */
export function reportDahliaError(kind: string, error: unknown, extra: Partial<DahliaErrorReport> = {}) {
  reporter?.report(kind, error, extra)
}

/** A platform's own reports (the desktop main process, Android crashes): taken at start and every few minutes. */
export function registerDahliaErrorSource(source: DahliaErrorSource) {
  sources.push(source)
  if (reporter)
    void reporter.takeFrom(source)
}

/** Starts the reports of this window. Call it after createApp and before mount. */
export function startDahliaErrorReports(app: App) {
  if (reporter || typeof window === 'undefined')
    return

  const current = createDahliaErrorReporter({
    send: sendToDahlia,
    canSend: () => !!dahliaKey(),
    platform: platformName(),
    userAgent: navigator.userAgent,
    page: pageName,
  })
  reporter = current

  const previous = app.config.errorHandler
  app.config.errorHandler = (error, instance, info) => {
    // Vue catches these and doesn't rethrow them, so the window's own error event never sees them.
    current.report('vue', error, info ? { kind: `vue (${info})` } : {})
    if (previous)
      previous(error, instance, info)
    else
      console.error(error)
  }

  window.addEventListener('error', (event) => {
    // A resource that failed to load has no error and no message; it isn't a script error.
    if (!event.error && !event.message)
      return
    current.report('error', event.error ?? event.message, event.error ? {} : { stack: `${event.filename}:${event.lineno}:${event.colno}` })
  })
  window.addEventListener('unhandledrejection', event => current.report('unhandledrejection', event.reason))

  const takeAll = () => {
    for (const source of sources)
      void current.takeFrom(source)
  }
  takeAll()
  setInterval(takeAll, SOURCE_POLL_MS)
}
