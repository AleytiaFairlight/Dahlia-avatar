// Dahlia: the Android app's updater. Like the desktop app, it looks for a newer release of the
// Dahlia-avatar repository on GitHub. Android downloads the APK in its browser and installs it over the
// app, because every release is signed with the same key. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls checkForDahliaUpdate() after the app starts.

import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { toast } from 'vue-sonner'

/** The published releases, newest first. Drafts are not listed without a GitHub login. */
export const DAHLIA_RELEASES_URL = 'https://api.github.com/repos/AleytiaFairlight/Dahlia-avatar/releases?per_page=20'

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

/** The newest published release that has an Android APK. */
export function newestAndroidRelease(releases: unknown): DahliaAndroidRelease | undefined {
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
      newest = { version, apkUrl: apk.browser_download_url as string }
  }
  return newest
}

/** The release to update to, or undefined when the app is up to date or GitHub doesn't answer. */
export async function findAndroidUpdate(currentVersion: string, fetcher: typeof fetch = fetch): Promise<DahliaAndroidRelease | undefined> {
  const response = await fetcher(DAHLIA_RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok)
    return undefined

  const newest = newestAndroidRelease(await response.json())
  return newest && compareVersions(newest.version, currentVersion) > 0 ? newest : undefined
}

/** Shows a notice with a download button when a newer release exists. Android only. */
export async function checkForDahliaUpdate() {
  if (Capacitor.getPlatform() !== 'android')
    return

  try {
    const { version } = await App.getInfo()
    const update = await findAndroidUpdate(version)
    if (!update)
      return

    toast(`Dahlia ${update.version} is available`, {
      description: 'Download it, then open the downloaded file to install the update. Your settings stay.',
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: 'Download',
        // The WebView hands addresses outside the app to Android, which downloads the APK.
        onClick: () => window.location.assign(update.apkUrl),
      },
    })
  }
  catch (error) {
    console.warn('Dahlia: could not check for an update', error)
  }
}
