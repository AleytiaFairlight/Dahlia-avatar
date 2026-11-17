// Dahlia: connects the avatar's animation library (stage-ui-three dahlia-animations.ts) to Dahlia's server, which
// keeps the library's dances and poses and sends them only to apps with a key (GET /api/v1/dahlia/animations and
// /api/v1/dahlia/animations/{name}.vrma). Their creators allow personal use but not handing the files out, so they
// aren't in the app: it downloads them in the background once it can reach the server, so they are on the device
// before they first play. Each app's main.ts starts this beside its error reports (scripts/apply_avatar_branding.sh).
// This file is Dahlia's (AIRI has no such file).
import type { DahliaAnimationServer, DahliaServerAnimation } from '@proj-airi/stage-ui-three/dahlia-animations'

import { downloadDahliaServerAnimations, setDahliaAnimationServer } from '@proj-airi/stage-ui-three/dahlia-animations'

import { dahliaHeaders, dahliaKey } from '../stores/dahlia-auth'
import { SERVER_URL } from './server'

/** The library's connection to the server at serverUrl, with the app's key. */
export function createDahliaAnimationServer(serverUrl = SERVER_URL, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): DahliaAnimationServer {
  async function get(path: string) {
    // Without a key the server would only refuse; the library asks again the next time it lists.
    if (!dahliaKey())
      throw new Error('Dahlia\'s key isn\'t set.')
    const response = await fetcher(`${serverUrl}${path}`, { headers: dahliaHeaders() })
    if (!response.ok)
      throw new Error(`Dahlia's server answered ${response.status}.`)
    return response
  }
  return {
    list: async () => ((await (await get('/api/v1/dahlia/animations')).json()) as { animations?: DahliaServerAnimation[] }).animations ?? [],
    download: async name => (await get(`/api/v1/dahlia/animations/${encodeURIComponent(name)}.vrma`)).blob(),
  }
}

/** The first background download waits this long after the app starts, so it doesn't slow the start down. */
export const DAHLIA_ANIMATION_DOWNLOAD_DELAY_MS = 15_000
/** Until the device has them all, it tries again this often (no key yet, offline, a download failed). */
export const DAHLIA_ANIMATION_DOWNLOAD_RETRY_MS = 3 * 60_000

/**
 * Downloads the library's animations in the background: a while after the app starts, then again every few minutes
 * until the device has them all, so a new install has them once its key is set. Only one window of the app does it.
 * A device that asks to save data gets each one when it first plays instead. Answers the function that stops it.
 */
export function startDahliaAnimationDownloads({
  download = downloadDahliaServerAnimations,
  delay = DAHLIA_ANIMATION_DOWNLOAD_DELAY_MS,
  savesData = deviceSavesData,
}: { download?: () => Promise<boolean>, delay?: number, savesData?: () => boolean } = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    if (savesData())
      return
    const done = await inOneWindow(() => download().catch(() => false))
    if (done === false)
      timer = setTimeout(run, DAHLIA_ANIMATION_DOWNLOAD_RETRY_MS)
  }
  timer = setTimeout(run, delay)
  return () => clearTimeout(timer)
}

function deviceSavesData() {
  return typeof navigator !== 'undefined' && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
}

/** Runs work in one window of the app at a time; undefined in a window while another one runs it. */
async function inOneWindow<Result>(work: () => Promise<Result>): Promise<Result | undefined> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request)
    return work()
  return locks.request('dahlia-animation-downloads', { ifAvailable: true }, async lock => lock ? work() : undefined)
}

export function startDahliaAnimationLibrary() {
  setDahliaAnimationServer(createDahliaAnimationServer())
  startDahliaAnimationDownloads()
}
