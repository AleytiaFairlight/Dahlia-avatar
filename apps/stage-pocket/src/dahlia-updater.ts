// Dahlia: the Android app's updater. Like the desktop app, it looks for a newer release of the
// Dahlia-avatar repository: first on Dahlia's server, which lists the same releases and sends the files
// faster, then on GitHub. The app downloads the APK itself and hands it to Android
// (android/.../dahlia/DahliaUpdater.kt), which installs it over the app because every release is signed with
// the same key. From Android 12, once Dahlia installed the running version, that happens without asking when
// the app leaves the screen; otherwise Android asks once with its "Update this app?" dialog. This file is
// Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls checkForDahliaUpdate() after the app
// starts.

import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'

/** The published releases, newest first. Drafts are not listed without a GitHub login. */
export const DAHLIA_RELEASES_URL = 'https://api.github.com/repos/AleytiaFairlight/Dahlia-avatar/releases?per_page=20'

/**
 * The same list from Dahlia's server. Its download addresses point at the server once it has a copy of
 * the release's files, and are relative to the server.
 */
export const DAHLIA_SERVER_RELEASES_URL = `${SERVER_URL}/api/v1/dahlia/releases`

export interface DahliaAndroidRelease {
  version: string
  apkUrl: string
}

/**
 * Compares two app versions, such as 0.12.0-beta.5.3. Numeric parts compare as numbers, and a version
 * without a pre-release part is newer than the same version with one.
 */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitVersion(a)
  const [coreB, preB] = splitVersion(b)

  const core = compareParts(coreA, coreB)
  if (core !== 0)
    return core
  if (preA.length === 0 || preB.length === 0)
    return preB.length - preA.length
  return compareParts(preA, preB)
}

function splitVersion(version: string): [string[], string[]] {
  const plain = version.trim().replace(/^v/i, '')
  const dash = plain.indexOf('-')
  const core = dash < 0 ? plain : plain.slice(0, dash)
  const pre = dash < 0 ? '' : plain.slice(dash + 1)
  return [core.split('.'), pre ? pre.split('.') : []]
}

function compareParts(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined || b[i] === undefined)
      return a[i] === undefined ? -1 : 1

    const numberA = /^\d+$/.test(a[i]) ? Number(a[i]) : undefined
    const numberB = /^\d+$/.test(b[i]) ? Number(b[i]) : undefined
    if (numberA !== undefined && numberB !== undefined) {
      if (numberA !== numberB)
        return numberA < numberB ? -1 : 1
    }
    // A numeric identifier is lower than a word, as in semantic versioning.
    else if (numberA !== undefined || numberB !== undefined) {
      return numberA !== undefined ? -1 : 1
    }
    else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1
    }
  }
  return 0
}

interface GitHubRelease {
  tag_name?: unknown
  draft?: unknown
  assets?: { name?: unknown, browser_download_url?: unknown }[]
}

/** The newest published release that has an Android APK. Its address is resolved against listUrl. */
export function newestAndroidRelease(releases: unknown, listUrl: string = DAHLIA_RELEASES_URL): DahliaAndroidRelease | undefined {
  if (!Array.isArray(releases))
    return undefined

  let newest: DahliaAndroidRelease | undefined
  for (const release of releases as GitHubRelease[]) {
    if (release.draft === true || typeof release.tag_name !== 'string')
      continue

    const apk = release.assets?.find(asset =>
      typeof asset.name === 'string'
      && asset.name.endsWith('-android.apk')
      && typeof asset.browser_download_url === 'string')
    if (!apk)
      continue

    const version = release.tag_name.replace(/^v/i, '')
    if (!newest || compareVersions(version, newest.version) > 0)
      newest = { version, apkUrl: new URL(apk.browser_download_url as string, listUrl).toString() }
  }
  return newest
}

/**
 * The release to update to, or undefined when the app is up to date or neither Dahlia's server nor
 * GitHub answers.
 */
export async function findAndroidUpdate(currentVersion: string, fetcher: typeof fetch = fetch): Promise<DahliaAndroidRelease | undefined> {
  for (const listUrl of [DAHLIA_SERVER_RELEASES_URL, DAHLIA_RELEASES_URL]) {
    let releases: unknown
    try {
      const response = await fetcher(listUrl, { headers: { Accept: 'application/vnd.github+json' } })
      if (!response.ok)
        continue
      releases = await response.json()
    }
    catch {
      continue
    }
    if (!Array.isArray(releases))
      continue

    const newest = newestAndroidRelease(releases, listUrl)
    return newest && compareVersions(newest.version, currentVersion) > 0 ? newest : undefined
  }
  return undefined
}

/** The update methods of the Android side (DahliaPlugin.kt). */
export interface DahliaUpdatePlugin {
  downloadUpdate: (options: { url: string, version: string }) => Promise<{ ready: boolean }>
  installUpdate: (options: { version: string }) => Promise<{ mode: 'when-hidden' | 'confirm' }>
}

/** How often to look for a release while the app runs, and at most how often when it comes back to the front. */
export const DAHLIA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
export const DAHLIA_UPDATE_RESUME_CHECK_MS = 15 * 60 * 1000

/** Android's "Update this app?" dialog comes back at most once a day for the same version. */
export const DAHLIA_UPDATE_ASK_AGAIN_MS = 24 * 60 * 60 * 1000
const ASKED_KEY = 'dahlia/update-asked'

export type DahliaUpdateResult = 'none' | 'when-hidden' | 'confirm' | 'asked-recently'

export interface DahliaUpdateDeps {
  plugin: DahliaUpdatePlugin
  fetcher?: typeof fetch
  now?: () => number
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

/**
 * One update round: finds a newer release, downloads it and hands it to Android. Returns what happens next:
 * nothing, an install when the app leaves the screen, or Android's dialog.
 */
export async function runDahliaUpdate(currentVersion: string, deps: DahliaUpdateDeps): Promise<DahliaUpdateResult> {
  const update = await findAndroidUpdate(currentVersion, deps.fetcher)
  if (!update)
    return 'none'

  await deps.plugin.downloadUpdate({ url: update.apkUrl, version: update.version })

  // Where Android has to ask, it asks once a day for a version: a dismissed dialog isn't shown at every check.
  const now = (deps.now ?? Date.now)()
  const storage = deps.storage ?? globalThis.localStorage
  let asked: { version?: string, at?: number } = {}
  try {
    asked = JSON.parse(storage?.getItem(ASKED_KEY) ?? '{}')
  }
  catch {}
  if (asked.version === update.version && typeof asked.at === 'number' && now - asked.at < DAHLIA_UPDATE_ASK_AGAIN_MS)
    return 'asked-recently'

  const { mode } = await deps.plugin.installUpdate({ version: update.version })
  if (mode === 'confirm')
    storage?.setItem(ASKED_KEY, JSON.stringify({ version: update.version, at: now }))
  return mode
}

let started = false
let running: Promise<unknown> | undefined
let lastRun = 0

/** Keeps the app up to date: at start, every hour, and when it comes back to the front. Android only. */
export async function checkForDahliaUpdate() {
  if (Capacitor.getPlatform() !== 'android' || started)
    return
  started = true

  const plugin = registerPlugin<DahliaUpdatePlugin>('Dahlia')
  const run = () => {
    lastRun = Date.now()
    running ??= (async () => {
      const { version } = await App.getInfo()
      await runDahliaUpdate(version, { plugin })
    })()
      .catch(error => console.warn('Dahlia: could not update', error))
      .finally(() => {
        running = undefined
      })
    return running
  }

  setInterval(() => void run(), DAHLIA_UPDATE_CHECK_INTERVAL_MS)
  void App.addListener('resume', () => {
    if (Date.now() - lastRun >= DAHLIA_UPDATE_RESUME_CHECK_MS)
      void run()
  })
  await run()
}
