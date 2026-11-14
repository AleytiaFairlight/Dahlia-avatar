// Dahlia: the avatar's animation library. A person adds their own VRM animation files (.vrma, for example the free
// motions creators publish on BOOTH) in Settings > Dahlia; they are kept in this app's storage on the device. Her
// 3D avatar then plays one now and then while it idles, when her answer asks for one (an ACT motion), when she uses
// her avatar_animation tool, or from the settings' Play button. components/DahliaAnimations.vue, inside the 3D
// scene, plays them. The library also comes with dances and poses by pixiv's VRoid Project and BOOTH creators,
// which their terms allow for personal, non-commercial use but not to be handed out where anyone could take them.
// So they aren't in the app: Dahlia's server lists them and sends each to apps with a key (DahliaBot
// src/Dahlia.Avatar/Gateway/AnimationLibrary.cs, credits in src/Dahlia.Avatar/Animations/CREDITS.md). stage-ui
// connects the server (libs/dahlia-animation-library.ts, setDahliaAnimationServer); an animation is downloaded the
// first time it plays, checked against its SHA-256 and kept on the device. The dances among them play only when
// asked for, not while she idles, unless the person allows it in the settings.
// This file is Dahlia's (AIRI has no such file).

/** An animation of the server's library. */
export interface DahliaServerAnimation {
  name: string
  bytes: number
  sha256: string
}

/** How the library reaches Dahlia's server. */
export interface DahliaAnimationServer {
  /** The animations it has. Throws when the server can't be reached or refuses the key. */
  list: () => Promise<DahliaServerAnimation[]>
  /** One animation's file. */
  download: (name: string) => Promise<Blob>
}

let animationServer: DahliaAnimationServer | undefined
let serverListing: Promise<DahliaServerAnimation[]> | undefined

/** Connects the library to Dahlia's server (stage-ui does this when an app starts). */
export function setDahliaAnimationServer(server: DahliaAnimationServer | undefined) {
  animationServer = server
  serverListing = undefined
}

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

/** The server's last list, for when it can't be reached: a JSON list of DahliaServerAnimation. */
export const DAHLIA_ANIMATION_SERVER_LIST_KEY = 'dahlia/avatar-server-animations'

const DATABASE = 'dahlia-avatar-animations'
/** The person's own files. */
const STORE = 'files'
/** The server's files this device downloaded. */
const SERVER_STORE = 'server'
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
interface DownloadedAnimation { name: string, sha256: string, file: Blob }

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    // Version 2 added the server's files beside the person's own.
    const request = indexedDB.open(DATABASE, 2)
    request.onupgradeneeded = () => {
      for (const name of [STORE, SERVER_STORE]) {
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: 'name' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The animation library can\'t be opened.'))
  })
}

async function inStore<Result>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<Result>, storeName = STORE) {
  const database = await open()
  try {
    return await new Promise<Result>((resolve, reject) => {
      const request = run(database.transaction(storeName, mode).objectStore(storeName))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('The animation library can\'t be read.'))
    })
  }
  finally {
    database.close()
  }
}

function isServerAnimation(value: unknown): value is DahliaServerAnimation {
  const entry = value as DahliaServerAnimation | null
  return typeof entry?.name === 'string' && /^[a-z0-9_]{1,60}$/.test(entry.name)
    && typeof entry.bytes === 'number' && typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256)
}

function savedServerList(): DahliaServerAnimation[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DAHLIA_ANIMATION_SERVER_LIST_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter(isServerAnimation) : []
  }
  catch {
    return []
  }
}

/**
 * The server's animations: asked once per run of the app (again after a failure), with its last answer kept for
 * when it can't be reached. Downloaded files the server no longer has are dropped.
 */
export function dahliaServerAnimations(): Promise<DahliaServerAnimation[]> {
  const server = animationServer
  if (!server)
    return Promise.resolve([])
  serverListing ??= server.list().then((answer) => {
    const list = (Array.isArray(answer) ? answer : []).filter(isServerAnimation)
    try {
      localStorage.setItem(DAHLIA_ANIMATION_SERVER_LIST_KEY, JSON.stringify(list))
    }
    catch {
      // Without storage it is asked again next time.
    }
    void inStore<IDBValidKey[]>('readonly', store => store.getAllKeys(), SERVER_STORE)
      .then(keys => Promise.all(keys.filter(key => !list.some(entry => entry.name === key))
        .map(key => inStore('readwrite', store => store.delete(key), SERVER_STORE))))
      .catch(() => {})
    return list
  }, () => {
    serverListing = undefined
    return savedServerList()
  })
  return serverListing
}

/** The animations in the library, by name: the person's own, and the server's ones they didn't replace. */
export async function listDahliaAnimations(): Promise<DahliaAnimationEntry[]> {
  // Without storage (a private window, or none at all) the server's ones are still there.
  const stored = await inStore<StoredAnimation[]>('readonly', store => store.getAll()).catch((): StoredAnimation[] => [])
  const own = stored.map(({ name, fileName, bytes, addedAt }): DahliaAnimationEntry => ({ name, fileName, bytes, addedAt }))
  const builtIn = (await dahliaServerAnimations())
    .filter(animation => !own.some(entry => entry.name === animation.name))
    .map(({ name, bytes }): DahliaAnimationEntry => ({ name, fileName: `${name}.vrma`, bytes, addedAt: 0, builtIn: true }))
  return [...own, ...builtIn].sort((a, b) => a.name.localeCompare(b.name))
}

async function sha256Of(file: Blob) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** A server animation's file: the one this device kept, or downloaded now (and kept) when it has none or an old one. */
async function serverAnimationFile(animation: DahliaServerAnimation): Promise<Blob | undefined> {
  const kept = await inStore<DownloadedAnimation | undefined>('readonly', store => store.get(animation.name), SERVER_STORE).catch(() => undefined)
  if (kept?.sha256 === animation.sha256)
    return kept.file
  const server = animationServer
  if (!server)
    return undefined
  const file = await server.download(animation.name).catch(() => undefined)
  if (!file || await sha256Of(file).catch(() => '') !== animation.sha256)
    return undefined
  const entry: DownloadedAnimation = { name: animation.name, sha256: animation.sha256, file }
  await inStore('readwrite', store => store.put(entry), SERVER_STORE).catch(() => {})
  return file
}

/** Where to load an animation from: the person's own file first, then the server's one. release frees it. */
export async function openDahliaAnimation(name: string): Promise<{ url: string, release: () => void } | undefined> {
  const own = (await inStore<StoredAnimation | undefined>('readonly', store => store.get(name)).catch(() => undefined))?.file
  const animation = own ? undefined : (await dahliaServerAnimations()).find(entry => entry.name === name)
  const file = own ?? (animation && await serverAnimationFile(animation))
  if (!file)
    return undefined
  const url = URL.createObjectURL(file)
  return { url, release: () => URL.revokeObjectURL(url) }
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
