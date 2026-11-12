// Dahlia: the avatar's animation library. A person adds their own VRM animation files (.vrma, for example the free
// motions creators publish on BOOTH) in Settings > Dahlia; they are kept in this app's storage on the device. Her
// 3D avatar then plays one now and then while it idles, when her answer asks for one (an ACT motion), when she uses
// her avatar_animation tool, or from the settings' Play button. components/DahliaAnimations.vue, inside the 3D
// scene, plays them. The idea comes from the animation library of dasilva333/airi; its bundled files are not
// included, because their creators don't allow passing the files on. This file is Dahlia's (AIRI has no such file).

export interface DahliaAnimationEntry {
  name: string
  fileName: string
  bytes: number
  addedAt: number
}

export type DahliaAnimationCommand
  = | { op: 'play', name: string, loop?: boolean }
    | { op: 'stop' }
    /** The library or its settings changed. */
    | { op: 'changed' }

/** "false" when the person turned idle animations off; on otherwise. */
export const DAHLIA_ANIMATION_IDLE_KEY = 'dahlia/avatar-idle-animations'
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

/** The animations in the library, by name. */
export async function listDahliaAnimations(): Promise<DahliaAnimationEntry[]> {
  const stored = await inStore<StoredAnimation[]>('readonly', store => store.getAll())
  return stored
    .map(({ name, fileName, bytes, addedAt }) => ({ name, fileName, bytes, addedAt }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** An animation's file, or undefined when the library has none by that name. */
export async function readDahliaAnimation(name: string) {
  return (await inStore<StoredAnimation | undefined>('readonly', store => store.get(name)))?.file
}

/** Adds a .vrma file, replacing an animation of the same name. */
export async function addDahliaAnimation(file: File) {
  const name = dahliaAnimationName(file.name)
  if (!/\.vrma$/i.test(file.name) || !name)
    throw new Error(`${file.name} is not a VRM animation (.vrma) file.`)
  if (file.size > DAHLIA_ANIMATION_MAX_BYTES)
    throw new Error(`${file.name} is larger than 30 MB.`)
  const existing = await listDahliaAnimations()
  if (existing.length >= DAHLIA_ANIMATION_MAX_FILES && !existing.some(entry => entry.name === name))
    throw new Error(`The library holds at most ${DAHLIA_ANIMATION_MAX_FILES} animations.`)
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
