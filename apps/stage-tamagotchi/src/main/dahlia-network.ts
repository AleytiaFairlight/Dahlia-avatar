// Dahlia: the desktop app connects only to Dahlia's server, to GitHub for its own updates, and to
// itself. This file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls
// restrictNetworkToDahlia() at the start of the main process.

import type { Session } from 'electron'

import process from 'node:process'

import { useLogg } from '@guiiai/logg'
import { app, session } from 'electron'

/** Hosts outside this machine that the app may reach. */
export const DAHLIA_ALLOWED_HOSTS: readonly string[] = [
  'dahlia.aleytia.moe',
  // Updates: the Dahlia-avatar releases API and release files, and the hosts GitHub sends downloads to.
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]

const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])

/**
 * Whether the app may open this URL. Only web and WebSocket addresses are judged: the app's own
 * schemes (files, models, bundled assets) never leave the machine.
 */
export function isAllowedUrl(url: string, allowedHosts: readonly string[] = DAHLIA_ALLOWED_HOSTS): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return true
  }
  if (!NETWORK_PROTOCOLS.has(parsed.protocol))
    return true

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host))
    return true
  return allowedHosts.includes(host)
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string')
    return input
  return input instanceof URL ? input.href : input.url
}

/**
 * Wraps a fetch so it refuses every URL {@link isAllowedUrl} rejects. The main process fetches with
 * Node's own fetch, which the session's request filter doesn't see.
 */
export function guardFetch(fetchImpl: typeof fetch, onBlocked: (url: string) => void, allowedHosts: readonly string[] = DAHLIA_ALLOWED_HOSTS): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input)
    if (isAllowedUrl(url, allowedHosts))
      return fetchImpl(input, init)
    onBlocked(url)
    return Promise.reject(new TypeError(`Dahlia blocked ${new URL(url).host}: the app connects only to Dahlia's server.`))
  }) as typeof fetch
}

/**
 * Cancels every request to a host outside {@link DAHLIA_ALLOWED_HOSTS}, from the app's windows and from
 * the main process. A test build can add its server with DAHLIA_EXTRA_ALLOWED_HOST.
 */
export function restrictNetworkToDahlia() {
  const log = useLogg('dahlia-network').useGlobalConfig()
  const extra = process.env.DAHLIA_EXTRA_ALLOWED_HOST?.trim().toLowerCase()
  const allowedHosts = extra ? [...DAHLIA_ALLOWED_HOSTS, extra] : DAHLIA_ALLOWED_HOSTS
  const onBlocked = (url: string) => log.warn(`Dahlia blocked a request to ${url.slice(0, 200)}`)

  const guarded = new WeakSet<Session>()
  const guardSession = (target: Session) => {
    if (guarded.has(target))
      return
    guarded.add(target)
    target.webRequest.onBeforeRequest((details, callback) => {
      const allowed = isAllowedUrl(details.url, allowedHosts)
      if (!allowed)
        onBlocked(details.url)
      callback({ cancel: !allowed })
    })
  }

  app.on('session-created', guardSession)
  void app.whenReady().then(() => guardSession(session.defaultSession))

  globalThis.fetch = guardFetch(globalThis.fetch.bind(globalThis), onBlocked, allowedHosts)
}
