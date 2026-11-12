// Dahlia: the avatar's animation library. A person adds their own VRM animation files (.vrma, for example the free
// motions creators publish on BOOTH) in Settings > Dahlia; they are kept in this app's storage on the device. Her
// 3D avatar then plays one now and then while it idles, when her answer asks for one (an ACT motion), when she uses
// her avatar_animation tool, or from the settings' Play button. components/DahliaAnimations.vue, inside the 3D
// scene, plays them. The library also comes with the animations the fork dasilva333/airi bundles
// (assets/vrm/animations/dahlia-library.ts; personal, non-commercial use, see DAHLIA-CREDITS.md there). The dances
// among them play only when asked for, not while she idles, unless the person allows it in the settings.
// This file is Dahlia's (AIRI has no such file).

import { dahliaBuiltInAnimations } from '../assets/vrm/animations/dahlia-library'

export interface DahliaAnimationEntry {
  name: string
  fileName: string
  bytes: number
  addedAt: number
  /** It came with the app; it can't be removed. */
  builtIn?: boolean
}

export type DahliaAnimationCommand
  = | { op: 'play', name: string, loop?: boolean }
    | { op: 'stop' }
    /** The library or its settings changed. */
    | { op: 'changed' }

/** "false" when the person turned idle animations off; on otherwise. */
export const DAHLIA_ANIMATION_IDLE_KEY = 'dahlia/avatar-idle-animations'
/** The names that play while she idles, a JSON list; without it, every animation but DAHLIA_ANIMATION_DANCES. */
export const DAHLIA_ANIMATION_IDLE_NAMES_KEY = 'dahlia/avatar-idle-animation-names'
/** Built-in dances: fun when asked for, too much while she just stands there. */
export const DAHLIA_ANIMATION_DANCES = ['ai_cat_dance', 'arms_up_down_dance', 'bling_bang', 'crab_dance', 'hito_mania', 'humans_are_just_cylinders', 'kawaii_kaiwai', 'ladylake', 'tetris']
/** Between two idle animations, in seconds: a random time in this range. */
export const DAHLIA_ANIMATION_IDLE_MIN_SECONDS = 45
export const DAHLIA_ANIMATION_IDLE_MAX_SECONDS = 90
export const DAHLIA_ANIMATION_MAX_BYTES = 30 * 1024 * 1024
export const DAHLIA_ANIMATION_MAX_FILES = 60

const DATABASE = 'dahlia-avatar-animations'
const STORE = 'files'
const CHANNEL = 'dahlia-avatar-animations'

/** The name an animation goes by, from its file name: "Crab Dance (v2).vrma" is "crab_dance_v2". */
export function dahliaAnimationName(fileName: string) {
  return fileName.replace(/\.vrma$/i, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60)
}

/** The library's name for what was asked: exact, or the same letters and digits ("Crab Dance", "crabDance"). */
export function findDahliaAnimation(names: string[], asked: string) {
  const plain = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const wanted = plain(asked.replace(/\.vrma$/i, ''))
  return wanted ? names.find(name => plain(name) === wanted) : undefined
}

/** A random animation, not the one played last when there is another. */
export function pickDahliaAnimation(names: string[], last: string | undefined, random: () => number = Math.random) {
  const others = names.filter(name => name !== last)
  const from = others.length > 0 ? others : names
  return from.length > 0 ? from[Math.min(from.length - 1, Math.floor(random() * from.length))] : undefined
}

/** Seconds until the next idle animation. */
export function nextDahliaIdleGap(random: () => number = Math.random) {
  return DAHLIA_ANIMATION_IDLE_MIN_SECONDS + random() * (DAHLIA_ANIMATION_IDLE_MAX_SECONDS - DAHLIA_ANIMATION_IDLE_MIN_SECONDS)
}

/** Which of the library's animations play while she idles: the person's choice, or all but the dances. */
export function dahliaIdleAnimationNames(names: string[], saved: string | null = readIdleNames()) {
  try {
    const chosen: unknown = saved ? JSON.parse(saved) : undefined
    if (Array.isArray(chosen))
      return names.filter(name => chosen.includes(name))
  }
  catch {
    // A broken setting counts as none.
  }
  return names.filter(name => !DAHLIA_ANIMATION_DANCES.includes(name))
}

function readIdleNames() {
  try {
    return localStorage.getItem(DAHLIA_ANIMATION_IDLE_NAMES_KEY)
  }
  catch {
    return null
  }
}

export function dahliaIdleAnimationsEnabled() {
  try {
    return localStorage.getItem(DAHLIA_ANIMATION_IDLE_KEY) !== 'false'
  }
  catch {
    return true
  }
}

interface StoredAnimation extends DahliaAnimationEntry { file: Blob }

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'name' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The animation library can\'t be opened.'))
  })
}

async function inStore<Result>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<Result>) {
  const database = await open()
  try {
    return await new Promise<Result>((resolve, reject) => {
      const request = run(database.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('The animation library can\'t be read.'))
    })
  }
  finally {
    database.close()
  }
}

/** The animations in the library, by name: the person's own, and the built-in ones they didn't replace. */
export async function listDahliaAnimations(): Promise<DahliaAnimationEntry[]> {
  // Without storage (a private window, or none at all) the built-in ones are still there.
  const stored = await inStore<StoredAnimation[]>('readonly', store => store.getAll()).catch((): StoredAnimation[] => [])
  const own = stored.map(({ name, fileName, bytes, addedAt }): DahliaAnimationEntry => ({ name, fileName, bytes, addedAt }))
  const builtIn = Object.keys(dahliaBuiltInAnimations)
    .filter(name => !own.some(entry => entry.name === name))
    .map((name): DahliaAnimationEntry => ({ name, fileName: `${name}.vrma`, bytes: 0, addedAt: 0, builtIn: true }))
  return [...own, ...builtIn].sort((a, b) => a.name.localeCompare(b.name))
}

/** Where to load an animation from: the person's own file first, then the built-in one. release frees it. */
export async function openDahliaAnimation(name: string): Promise<{ url: string, release: () => void } | undefined> {
  const file = (await inStore<StoredAnimation | undefined>('readonly', store => store.get(name)).catch(() => undefined))?.file
  if (file) {
    const url = URL.createObjectURL(file)
    return { url, release: () => URL.revokeObjectURL(url) }
  }
  const builtIn = dahliaBuiltInAnimations[name]
  return builtIn ? { url: builtIn, release: () => {} } : undefined
}

/** Adds a .vrma file, replacing an animation of the same name. */
export async function addDahliaAnimation(file: File) {
  const name = dahliaAnimationName(file.name)
  if (!/\.vrma$/i.test(file.name) || !name)
    throw new Error(`${file.name} is not a VRM animation (.vrma) file.`)
  if (file.size > DAHLIA_ANIMATION_MAX_BYTES)
    throw new Error(`${file.name} is larger than 30 MB.`)
  const existing = (await listDahliaAnimations()).filter(entry => !entry.builtIn)
  if (existing.length >= DAHLIA_ANIMATION_MAX_FILES && !existing.some(entry => entry.name === name))
    throw new Error(`The library holds at most ${DAHLIA_ANIMATION_MAX_FILES} animations of your own.`)
  const entry: StoredAnimation = { name, fileName: file.name, bytes: file.size, addedAt: Date.now(), file }
  await inStore('readwrite', store => store.put(entry))
  sendDahliaAnimationCommand({ op: 'changed' })
  return name
}

export async function removeDahliaAnimation(name: string) {
  await inStore('readwrite', store => store.delete(name))
  sendDahliaAnimationCommand({ op: 'changed' })
}

/** To the 3D scenes of every window of the app (the settings are another window than the avatar). */
export function sendDahliaAnimationCommand(command: DahliaAnimationCommand) {
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage(command)
  channel.close()
}

/** Listens for commands; answers the function that stops listening. */
export function onDahliaAnimationCommand(listener: (command: DahliaAnimationCommand) => void) {
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = event => listener(event.data as DahliaAnimationCommand)
  return () => channel.close()
}
