// Dahlia: updates the desktop app without asking. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh starts it in src/main/index.ts.
//
// AIRI's updater checks once at startup and waits for a click to download and another to install. Dahlia
// instead checks every hour, downloads a new release as soon as it is found, and installs it when nobody has
// used the computer for a while: the installer runs silently and starts the app again. An update that is
// downloaded is also installed when the app quits (electron-updater's autoInstallOnAppQuit).

import type { AutoUpdaterState } from '@proj-airi/electron-eventa/electron-updater'

import type { AutoUpdater } from './services/electron/auto-updater'

import { useLogg } from '@guiiai/logg'
import { powerMonitor } from 'electron'

/** How often to look for a new release while the app runs. */
export const DAHLIA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** How long the computer must be unused (no keyboard or mouse) before the app restarts to install. */
export const DAHLIA_UPDATE_IDLE_SECONDS = 10 * 60

/** How often to look whether the computer is idle once an update is downloaded. */
export const DAHLIA_UPDATE_INSTALL_POLL_MS = 60 * 1000

export interface DahliaAutoUpdateDeps {
  /** Seconds since the last keyboard or mouse input on the computer. */
  idleSeconds: () => number
  setInterval: (callback: () => void, ms: number) => unknown
  clearInterval: (timer: unknown) => void
}

const defaultDeps: DahliaAutoUpdateDeps = {
  idleSeconds: () => powerMonitor.getSystemIdleTime(),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: timer => clearInterval(timer as ReturnType<typeof setInterval>),
}

/**
 * Downloads updates as soon as they are found, checks for them every hour, and installs a downloaded update
 * once the computer has been idle. Returns a function that stops it. Does nothing when updates are off
 * (development builds, and installs a package manager updates).
 */
export function setupDahliaAutoUpdate(updater: AutoUpdater, deps: DahliaAutoUpdateDeps = defaultDeps): () => void {
  if (updater.state.status === 'disabled')
    return () => {}

  const log = useLogg('dahlia-auto-update').useGlobalConfig()
  let installing = false

  const onState = (state: AutoUpdaterState) => {
    // The updater shares one download between callers, so a repeated 'available' starts nothing new.
    if (state.status === 'available') {
      log.log(`downloading ${state.info?.version ?? 'the new release'}`)
      void updater.downloadUpdate().catch(error => log.withError(error).warn('download failed; trying again at the next check'))
    }
  }

  const unsubscribe = updater.subscribe(onState)
  onState(updater.state)

  const checkTimer = deps.setInterval(() => {
    // A downloaded update is installed by the idle timer; checking again would only find the same release.
    if (updater.state.status === 'downloaded' || updater.state.status === 'downloading')
      return
    void updater.checkForUpdates().catch(error => log.withError(error).warn('update check failed'))
  }, DAHLIA_UPDATE_CHECK_INTERVAL_MS)

  const installTimer = deps.setInterval(() => {
    if (installing || updater.state.status !== 'downloaded' || deps.idleSeconds() < DAHLIA_UPDATE_IDLE_SECONDS)
      return

    installing = true
    log.log(`installing ${updater.state.info?.version ?? 'the update'} while the computer is idle`)
    // On Windows the installer runs silently and starts the app again (see quitAndInstall in auto-updater.ts).
    void updater.quitAndInstall().catch((error) => {
      installing = false
      log.withError(error).warn('install failed; it runs again when the app quits')
    })
  }, DAHLIA_UPDATE_INSTALL_POLL_MS)

  return () => {
    unsubscribe()
    deps.clearInterval(checkTimer)
    deps.clearInterval(installTimer)
  }
}
