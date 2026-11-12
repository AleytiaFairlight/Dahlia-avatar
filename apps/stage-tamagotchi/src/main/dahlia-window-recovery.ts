import type { WebContents } from 'electron'

import { app } from 'electron'

// Dahlia's file (not AIRI's), started by setupDahliaErrorReports().
//
// A stopped page stays blank until the app restarts, and the main window holds Dahlia's chat and her tools (Home
// Assistant's among them), so the page is reloaded. MAX_RELOADS in RELOAD_WINDOW_MS keeps a broken page from looping.

export const MAX_RELOADS = 3
export const RELOAD_WINDOW_MS = 5 * 60_000
export const RELOAD_DELAY_MS = 1_000

/**
 * Decides whether a page that stopped is reloaded.
 *
 * Expects:
 * - `reason` is Electron's `render-process-gone` reason
 * - `history` holds the times of this window's earlier reloads, oldest first, and is updated in place
 *
 * Returns:
 * - true when the page should be reloaded now
 */
export function shouldReloadPage(reason: string, history: number[], now: number, quitting: boolean): boolean {
  // A clean exit is the page closing on purpose, and while the app quits every page goes.
  if (quitting || reason === 'clean-exit')
    return false

  while (history.length && now - history[0] > RELOAD_WINDOW_MS)
    history.shift()
  if (history.length >= MAX_RELOADS)
    return false

  history.push(now)
  return true
}

export function setupDahliaWindowRecovery() {
  const reloads = new WeakMap<WebContents, number[]>()
  let quitting = false
  app.on('before-quit', () => {
    quitting = true
  })

  app.on('render-process-gone', (_event, contents, details) => {
    if (contents.isDestroyed())
      return

    const history = reloads.get(contents) ?? []
    reloads.set(contents, history)
    if (!shouldReloadPage(details.reason, history, Date.now(), quitting)) {
      if (!quitting && details.reason !== 'clean-exit')
        console.warn(`[Dahlia] A window's page stopped ${MAX_RELOADS} times in a row (${details.reason}); not reloading it again.`)
      return
    }

    console.warn(`[Dahlia] A window's page stopped (${details.reason}); reloading it.`)
    setTimeout(() => {
      if (!contents.isDestroyed())
        contents.reload()
    }, RELOAD_DELAY_MS)
  })
}
