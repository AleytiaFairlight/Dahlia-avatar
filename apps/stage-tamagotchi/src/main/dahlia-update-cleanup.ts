// Dahlia: removes old Dahlia installers and APKs from the Downloads folder when the desktop app starts. This file is
// Dahlia's (AIRI has no such file); dahlia-auto-update.ts runs it.
//
// The app updates itself, and the updater's own download cache is emptied at every start (auto-updater.ts), but
// installers and APKs downloaded by hand from Dahlia's download page or GitHub stay in Downloads, a few hundred MB per
// release. Only Dahlia's own release files go (Dahlia-<version>-windows-x64-setup.exe and Dahlia-<version>-android.apk,
// with a browser's " (1)" copies), and only for versions older than the app that runs. Everything else stays.

import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import semver from 'semver'

import { app } from 'electron'

/** A release file of Dahlia-avatar, as GitHub and Dahlia's download page name it, or a browser's numbered copy. */
const RELEASE_FILE = /^Dahlia-(\d+\.\d+\.\d+(?:-[0-9A-Z]+(?:\.[0-9A-Z]+)*)?)-(?:windows-x64-setup|android)(?: \(\d+\))?\.(?:exe|apk)$/i

/** The version in the name of one of Dahlia's release files; undefined for any other file. */
export function releaseFileVersion(name: string): string | undefined {
  const version = RELEASE_FILE.exec(name)?.[1]
  return version && semver.valid(version) ? version : undefined
}

/** The release files in a folder that are older than the version that runs. */
export function oldReleaseFiles(names: string[], runningVersion: string): string[] {
  if (!semver.valid(runningVersion))
    return []
  return names.filter((name) => {
    const version = releaseFileVersion(name)
    return version !== undefined && semver.lt(version, runningVersion)
  })
}

export interface DahliaUpdateCleanupDeps {
  /** The folder to clean: the user's Downloads. */
  folder: () => string
  /** The version of the app that runs. */
  version: () => string
  list: (folder: string) => Promise<string[]>
  remove: (path: string) => Promise<void>
}

const defaultDeps: DahliaUpdateCleanupDeps = {
  folder: () => app.getPath('downloads'),
  version: () => app.getVersion(),
  list: folder => readdir(folder),
  // Not recursive: a folder that happens to have such a name stays.
  remove: path => rm(path, { force: true }),
}

/** Removes Dahlia's release files that are older than the running app from Downloads; returns their names. */
export async function cleanOldDahliaDownloads(deps: DahliaUpdateCleanupDeps = defaultDeps): Promise<string[]> {
  const folder = deps.folder()
  const names = await deps.list(folder).catch(() => [] as string[])
  const removed: string[] = []
  for (const name of oldReleaseFiles(names, deps.version())) {
    try {
      await deps.remove(join(folder, name))
      removed.push(name)
    }
    catch {
      // Open in another program, or gone already: it is tried again at the next start.
    }
  }
  return removed
}
