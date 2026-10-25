// Dahlia: who uses the apps, and their voice check. Dahlia's server knows the owner (the hub token) and the
// people she made keys for (src/Dahlia.Avatar/Gateway/AvatarUsers.cs). The key alone opens only the voice
// check: a passed check gives this device a session for 6 hours, and the apps send the session instead of
// the key everywhere else (dahliaBearer). This file is Dahlia's (AIRI has no such file).

import { getActivePinia } from 'pinia'
import { computed, reactive } from 'vue'

import { DAHLIA_CHAT_PROVIDER_ID } from '../libs/providers/providers/dahlia'
import { SERVER_URL } from '../libs/server'
import { useProviderConfigStore } from './providers/config'

/** Who the key belongs to, and their voice check (GET /api/v1/dahlia/me). */
export interface DahliaMe {
  id: string
  name: string
  owner: boolean
  voicePrint: boolean
  enrollSamples: number
  enrollNeeded: number
  verified: boolean
  expiresAt?: string | null
}

/** Digits to read aloud for the voice check. */
export interface DahliaChallenge {
  id: string
  digits: string
  text: string
}

export type DahliaVoiceResult
  = | { ok: true, done: boolean, samples?: number, needed?: number }
    | { ok: false, code?: string, message: string }

interface StoredSession {
  token: string
  expiresAt: string
  /** The end of the key it was made with: another key's session isn't sent. */
  keyTail: string
}

/** The session of this device, kept for all windows of the app. */
export const DAHLIA_SESSION_KEY = 'dahlia/session'
/** This device's id: the desktop app's remote tools use the same one. */
export const DAHLIA_DEVICE_ID_KEY = 'dahlia/device-id'
/** Who the key belongs to, as the server last said, so the chats know their person as soon as the app starts. */
export const DAHLIA_ME_KEY = 'dahlia/me'
/** A session this close to its end is checked again already. */
const SESSION_MARGIN_MS = 60_000

function readSession(): StoredSession | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(DAHLIA_SESSION_KEY) ?? 'null') as StoredSession | null
    return value?.token && value.expiresAt ? value : undefined
  }
  catch {
    return undefined
  }
}

function readMe(): (DahliaMe & { keyTail?: string }) | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(DAHLIA_ME_KEY) ?? 'null') as (DahliaMe & { keyTail?: string }) | null
    return value?.id ? value : undefined
  }
  catch {
    return undefined
  }
}

const state = reactive({
  session: readSession(),
  me: readMe() as (DahliaMe & { keyTail?: string }) | undefined,
  now: Date.now(),
})

if (typeof window !== 'undefined') {
  // Another window of the app passed the check, or the session ran out.
  window.addEventListener('storage', (event) => {
    if (event.key === DAHLIA_SESSION_KEY)
      state.session = readSession()
    else if (event.key === DAHLIA_ME_KEY)
      state.me = readMe()
  })
  setInterval(() => state.now = Date.now(), 30_000)
}

function keyTail(key: string) {
  return key.slice(-8)
}

/** The Dahlia key, as saved for the chat provider. */
export function dahliaKey(): string {
  if (!getActivePinia())
    return ''
  const apiKey = useProviderConfigStore().getProviderConfig(DAHLIA_CHAT_PROVIDER_ID)?.apiKey
  return typeof apiKey === 'string' ? apiKey.trim() : ''
}

/** This device's id, made once. */
export function dahliaDeviceId(): string {
  let id = localStorage.getItem(DAHLIA_DEVICE_ID_KEY)
  if (!id) {
    id = `dev-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    localStorage.setItem(DAHLIA_DEVICE_ID_KEY, id)
  }
  return id
}

/** The session token while it lasts, for the saved key. */
export function dahliaSession(key = dahliaKey()): string | undefined {
  const session = state.session
  if (!key || !session || session.keyTail !== keyTail(key))
    return undefined
  return Date.parse(session.expiresAt) - SESSION_MARGIN_MS > state.now ? session.token : undefined
}

/** What the apps send as "Authorization: Bearer": the session, or the key while there is none. */
export function dahliaBearer(): string {
  return dahliaSession() ?? dahliaKey()
}

/** Headers for Dahlia's server: the bearer and this device's id. */
export function dahliaHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Authorization': `Bearer ${dahliaBearer()}`, 'X-Dahlia-Device': dahliaDeviceId(), ...extra }
}

export function saveDahliaSession(token: string, expiresAt: string) {
  const session = { token, expiresAt, keyTail: keyTail(dahliaKey()) }
  localStorage.setItem(DAHLIA_SESSION_KEY, JSON.stringify(session))
  state.session = session
  state.now = Date.now()
}

export function clearDahliaSession() {
  localStorage.removeItem(DAHLIA_SESSION_KEY)
  state.session = undefined
}

async function errorOf(response: Response): Promise<{ code?: string, message: string }> {
  try {
    const { error } = await response.json() as { error?: { code?: string, message?: string } }
    if (error?.message)
      return { code: error.code, message: error.message }
  }
  catch {}
  return { message: response.status === 401 ? 'Dahlia\'s server didn\'t accept the key.' : `Dahlia's server answered ${response.status}.` }
}

/** Who the key belongs to; undefined when the server can't be asked or doesn't know the key. */
export async function fetchDahliaMe(): Promise<DahliaMe | undefined> {
  if (!dahliaKey())
    return undefined
  try {
    const response = await fetch(`${SERVER_URL}/api/v1/dahlia/me`, { headers: dahliaHeaders() })
    if (response.status === 401 && dahliaSession()) {
      // The session ended on the server (a new key, or the owner signed this person out).
      clearDahliaSession()
      return await fetchDahliaMe()
    }
    if (!response.ok)
      return undefined
    const me = await response.json() as DahliaMe
    state.me = me
    try {
      localStorage.setItem(DAHLIA_ME_KEY, JSON.stringify({ ...me, keyTail: keyTail(dahliaKey()) }))
    }
    catch {}
    if (!me.verified && dahliaSession())
      clearDahliaSession()
    return me
  }
  catch {
    return undefined
  }
}

export async function requestDahliaChallenge(): Promise<DahliaChallenge> {
  const response = await fetch(`${SERVER_URL}/api/v1/dahlia/voice-check/challenge`, { method: 'POST', headers: dahliaHeaders() })
  if (!response.ok)
    throw new Error((await errorOf(response)).message)
  return await response.json() as DahliaChallenge
}

/** Sends a recording of a challenge's digits: an enrollment sample or the check. */
export async function sendDahliaVoice(kind: 'enroll' | 'verify', challenge: DahliaChallenge, wav: Blob): Promise<DahliaVoiceResult> {
  const response = await fetch(`${SERVER_URL}/api/v1/dahlia/voice-check/${kind}?challenge=${encodeURIComponent(challenge.id)}`, {
    method: 'POST',
    headers: dahliaHeaders({ 'Content-Type': 'audio/wav' }),
    body: wav,
  })
  if (!response.ok)
    return { ok: false, ...(await errorOf(response)) }

  const result = await response.json() as { session?: string, expiresAt?: string, done?: boolean, samples?: number, needed?: number }
  if (result.session && result.expiresAt)
    saveDahliaSession(result.session, result.expiresAt)
  await fetchDahliaMe()
  return { ok: true, done: kind === 'verify' || result.done === true, samples: result.samples, needed: result.needed }
}

/** Signs this device out: the next request needs a new voice check. */
export async function signOutDahlia() {
  const token = dahliaSession()
  clearDahliaSession()
  if (token)
    await fetch(`${SERVER_URL}/api/v1/dahlia/me/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined)
  await fetchDahliaMe()
}

/** The sign-in state for pages and the voice check dialog. */
export function useDahliaAuth() {
  const key = computed(() => dahliaKey())
  const session = computed(() => dahliaSession(key.value))
  return {
    key,
    // Only the person of the saved key: after a key change the old answer doesn't count.
    me: computed(() => state.me && (state.me.keyTail === undefined || state.me.keyTail === keyTail(key.value)) ? state.me : undefined),
    session,
    expiresAt: computed(() => session.value ? state.session?.expiresAt : undefined),
    /** The key is set and this device has no session: chats wait for the voice check. */
    needsVoiceCheck: computed(() => !!key.value && !session.value),
    refresh: fetchDahliaMe,
  }
}
