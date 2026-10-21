// Dahlia: Dahlia's server lists the app's releases as GitHub does and keeps a copy of the newest one's
// files, which it sends faster than GitHub. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh makes the desktop updater ask the server first.

/** The release list on Dahlia's server, in the shape of GitHub's. */
export const DAHLIA_SERVER_RELEASES_URL = 'https://dahlia.aleytia.moe/api/v1/dahlia/releases'

export interface DahliaServerRelease {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  assets?: { name?: string, browser_download_url?: string }[]
}

/** The releases on Dahlia's server, or none when it doesn't answer. */
export async function fetchDahliaServerReleases(fetcher: typeof fetch = fetch): Promise<DahliaServerRelease[]> {
  try {
    const response = await fetcher(DAHLIA_SERVER_RELEASES_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok)
      return []
    const payload = await response.json()
    return Array.isArray(payload) ? payload as DahliaServerRelease[] : []
  }
  catch {
    return []
  }
}

/**
 * The update feed for a release: the server folder that holds its update file (such as latest-x64.yml)
 * when the server has a copy of the release, or the fallback (the release on GitHub).
 */
export function dahliaFeedUrl(releases: DahliaServerRelease[], tag: string, updateFile: string, fallback: string): string {
  const asset = releases.find(release => release.tag_name === tag)?.assets?.find(asset => asset.name === updateFile)
  if (typeof asset?.browser_download_url !== 'string')
    return fallback

  const server = new URL(DAHLIA_SERVER_RELEASES_URL)
  const url = new URL(asset.browser_download_url, server)
  if (url.origin !== server.origin)
    return fallback
  return url.toString().slice(0, url.toString().lastIndexOf('/'))
}
