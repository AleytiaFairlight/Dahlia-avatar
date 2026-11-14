// Dahlia: her Image Generation module, the Artistry module of the apps. Her image model runs on her server's side
// (a helper PC's GPU, while her model server is in light mode), so the apps only ask Dahlia's server: the module's
// state (GET /api/v1/dahlia/images/status) and a picture (POST /api/v1/dahlia/images, the owner's key). In the chat
// she draws with her draw_picture tool, which the server runs itself. The Artistry page (components/modules/
// DahliaArtistry.vue) uses this file. This file is Dahlia's (AIRI has no such file).
import { dahliaHeaders, dahliaKey } from '../stores/dahlia-auth'
import { SERVER_URL } from './server'

/** The module's state. connected is false when Dahlia's server can't reach it. */
export interface DahliaImageStatus {
  connected: boolean
  /** Only the owner's key can have pictures drawn: each takes her large model offline for a few minutes. */
  canDraw: boolean
  busy?: boolean
  waiting?: number
  /** The name of the image model that draws when none is chosen (none while there are several to choose from). */
  model?: string | null
  /** Her image models: id (what a picture asks for) and name. */
  models?: { id: string, name: string }[]
  /** The id of the image model that draws when none is chosen. */
  default?: string | null
  last?: { at: number, seconds: number, model?: string | null, size: string } | null
}

/** A picture she drew: its address on Dahlia's server (it opens without the key) and how it was made. */
export interface DahliaPicture {
  url: string
  seconds: number
  seed: number
  model?: string | null
  /** Her model server went back to full mode after it: her large model loads for about two minutes. */
  restoring: boolean
}

export type DahliaPictureShape = 'square' | 'portrait' | 'landscape'

async function errorOf(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } }
    if (body.error?.message)
      return body.error.message
  }
  catch {
    // Not JSON: the status says it.
  }
  return `Dahlia's server answered ${response.status}.`
}

export async function getDahliaImageStatus(serverUrl = SERVER_URL, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<DahliaImageStatus> {
  if (!dahliaKey())
    throw new Error('Dahlia\'s key isn\'t set.')
  const response = await fetcher(`${serverUrl}/api/v1/dahlia/images/status`, { headers: dahliaHeaders() })
  if (!response.ok)
    throw new Error(await errorOf(response))
  return await response.json() as DahliaImageStatus
}

/** Has a picture drawn. It takes a few minutes, longer when other pictures wait. */
export async function drawDahliaPicture(prompt: string, options: { shape?: DahliaPictureShape, avoid?: string, model?: string, signal?: AbortSignal } = {}, serverUrl = SERVER_URL, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<DahliaPicture> {
  if (!dahliaKey())
    throw new Error('Dahlia\'s key isn\'t set.')
  const response = await fetcher(`${serverUrl}/api/v1/dahlia/images`, {
    method: 'POST',
    headers: dahliaHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prompt, shape: options.shape ?? 'square', avoid: options.avoid || undefined, model: options.model || undefined }),
    signal: options.signal,
  })
  if (!response.ok)
    throw new Error(await errorOf(response))
  return await response.json() as DahliaPicture
}
