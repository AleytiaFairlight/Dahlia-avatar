// Dahlia: the Android app connects only to Dahlia's server and to itself, and asks GitHub's API for
// updates. The WebView enforces it through a Content Security Policy, which covers fetch, WebSockets,
// images, sound and fonts. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls installDahliaContentSecurityPolicy() before the app starts.

import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'

/** The update check (dahlia-updater.ts) asks GitHub's API for the newest release. */
export const GITHUB_API_ORIGIN = 'https://api.github.com'

/** The policy: the app itself ('self', blob: and data: URLs) and Dahlia's server, and GitHub's API for requests. */
export function dahliaContentSecurityPolicy(serverUrl: string = SERVER_URL): string {
  const server = new URL(serverUrl)
  const socket = `${server.protocol === 'https:' ? 'wss:' : 'ws:'}//${server.host}`
  const sources = ['\'self\'', 'blob:', 'data:', server.origin, socket].join(' ')
  return ['connect-src', 'img-src', 'media-src', 'font-src']
    .map(directive => `${directive} ${sources}${directive === 'connect-src' ? ` ${GITHUB_API_ORIGIN}` : ''}`)
    .join('; ')
}

/** Adds the policy to the page. Requests made after this are held to it. */
export function installDahliaContentSecurityPolicy(doc: Document = document, serverUrl: string = SERVER_URL) {
  const meta = doc.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = dahliaContentSecurityPolicy(serverUrl)
  doc.head.prepend(meta)
}
