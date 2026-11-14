// Dahlia: connects the avatar's animation library (stage-ui-three dahlia-animations.ts) to Dahlia's server, which
// keeps the library's dances and poses and sends them only to apps with a key (GET /api/v1/dahlia/animations and
// /api/v1/dahlia/animations/{name}.vrma). Their creators allow personal use but not handing the files out, so they
// aren't in the app. Each app's main.ts starts this beside its error reports (scripts/apply_avatar_branding.sh).
// This file is Dahlia's (AIRI has no such file).
import type { DahliaAnimationServer, DahliaServerAnimation } from '@proj-airi/stage-ui-three/dahlia-animations'

import { setDahliaAnimationServer } from '@proj-airi/stage-ui-three/dahlia-animations'

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

export function startDahliaAnimationLibrary() {
  setDahliaAnimationServer(createDahliaAnimationServer())
}
