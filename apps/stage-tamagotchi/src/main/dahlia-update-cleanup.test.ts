// Dahlia: tests for dahlia-update-cleanup.ts, which removes old Dahlia installers and APKs from Downloads.
import { describe, expect, it, vi } from 'vitest'

import { cleanOldDahliaDownloads, oldReleaseFiles, releaseFileVersion } from './dahlia-update-cleanup'

vi.mock('electron', () => ({ app: { getPath: vi.fn(), getVersion: vi.fn() } }))

describe('dahlia update cleanup', () => {
  it('reads the version of Dahlia release files only', () => {
    expect(releaseFileVersion('Dahlia-0.12.0-beta.5.26-windows-x64-setup.exe')).toBe('0.12.0-beta.5.26')
    expect(releaseFileVersion('Dahlia-0.12.0-beta.5.26-android.apk')).toBe('0.12.0-beta.5.26')
    expect(releaseFileVersion('Dahlia-0.12.0-beta.5.20-windows-x64-setup (1).exe')).toBe('0.12.0-beta.5.20')
    expect(releaseFileVersion('Dahlia-0.11.3-android.apk')).toBe('0.11.3')

    expect(releaseFileVersion('Dahlia-notes.pdf')).toBeUndefined()
    expect(releaseFileVersion('Dahlia-0.12.0-beta.5.26-windows-x64-setup.exe.blockmap')).toBeUndefined()
    expect(releaseFileVersion('Dahlia-0.12.0-beta.5.26-windows-x64-setup.exe.crdownload')).toBeUndefined()
    expect(releaseFileVersion('AIRI-0.12.0-windows-x64-setup.exe')).toBeUndefined()
    expect(releaseFileVersion('My Dahlia-0.12.0-android.apk')).toBeUndefined()
  })

  it('picks the release files older than the running app, and keeps this version and newer ones', () => {
    const names = [
      'Dahlia-0.12.0-beta.5.9-android.apk',
      'Dahlia-0.12.0-beta.5.26-windows-x64-setup.exe',
      'Dahlia-0.12.0-beta.5.27-windows-x64-setup.exe',
      'Dahlia-0.12.0-beta.5.28-android.apk',
      'Dahlia-0.11.9-windows-x64-setup (2).exe',
      'vacation.jpg',
    ]

    // beta.5.9 is older than beta.5.27: prerelease numbers compare as numbers, not as text.
    expect(oldReleaseFiles(names, '0.12.0-beta.5.27')).toEqual([
      'Dahlia-0.12.0-beta.5.9-android.apk',
      'Dahlia-0.12.0-beta.5.26-windows-x64-setup.exe',
      'Dahlia-0.11.9-windows-x64-setup (2).exe',
    ])
    expect(oldReleaseFiles(names, 'not a version')).toEqual([])
  })

  it('removes the old release files from the folder, and goes on when one cannot be removed', async () => {
    const remove = vi.fn(async (path: string) => {
      if (path.includes('5.25'))
        throw new Error('open in another program')
    })

    const removed = await cleanOldDahliaDownloads({
      folder: () => '/home/me/Downloads',
      version: () => '0.12.0-beta.5.27',
      list: async () => ['Dahlia-0.12.0-beta.5.25-android.apk', 'Dahlia-0.12.0-beta.5.26-windows-x64-setup.exe', 'Dahlia-0.12.0-beta.5.27-android.apk', 'notes.txt'],
      remove,
    })

    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledWith('/home/me/Downloads/Dahlia-0.12.0-beta.5.26-windows-x64-setup.exe')
    expect(removed).toEqual(['Dahlia-0.12.0-beta.5.26-windows-x64-setup.exe'])
  })

  it('does nothing when the folder cannot be read', async () => {
    const remove = vi.fn()

    const removed = await cleanOldDahliaDownloads({
      folder: () => '/nowhere',
      version: () => '0.12.0-beta.5.27',
      list: async () => { throw new Error('ENOENT') },
      remove,
    })

    expect(removed).toEqual([])
    expect(remove).not.toHaveBeenCalled()
  })
})
