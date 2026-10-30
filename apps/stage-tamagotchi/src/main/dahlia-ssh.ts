// Dahlia: SSH from this PC for Dahlia (the "ssh", "ssh_key" and "ssh_install_key" tools of
// src/renderer/dahlia-remote-tools.ts, on the "dahlia:ssh" channel), with ssh2. She gives the host, the user and
// the command; the login is this PC's key (~/.ssh/id_ed25519, made here if there is none, which `ssh` in
// PowerShell uses too) or a password saved in Settings > Dahlia, kept encrypted with Windows' DPAPI (Electron's
// safeStorage). A password never reaches her, the chat or the logs: OpenSSH's ssh.exe can't take one without a
// console, which her PowerShell runs without. A server's host key is trusted the first time and checked after
// that. This file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls setupDahliaSsh().

import type { AnyAuthMethod, Client, ParsedKey, Prompt } from 'ssh2'

import os from 'node:os'
import path from 'node:path'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { errorMessageFrom } from '@moeru/std'
import { app, ipcMain, safeStorage } from 'electron'

export const DAHLIA_SSH_CHANNEL = 'dahlia:ssh'
export const DAHLIA_SSH_SETTINGS_CHANNEL = 'dahlia:ssh-settings'
export const DAHLIA_SSH_MAX_OUTPUT = 16_000
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000
const CONNECT_TIMEOUT_MS = 15_000
/** This PC's keys that the login tries, in order: the one made here comes first. */
const KEY_FILES = ['id_ed25519', 'id_ecdsa', 'id_rsa']

/** ssh2, loaded on the first use: a problem loading it then breaks SSH, not the app's start. */
const ssh2 = () => import('ssh2')

export interface DahliaSshTarget {
  host: string
  user: string
  port?: number
}

export type DahliaSshRequest
  = | ({ op: 'run', command: string, timeoutSeconds?: number } & DahliaSshTarget)
    | ({ op: 'install_key' } & DahliaSshTarget)
    | { op: 'key' }

export interface DahliaSshResult {
  ok: boolean
  exitCode: number | null
  output: string
}

export type DahliaSshSettingsRequest
  = | { op: 'list' }
    | { op: 'create-key' }
    | ({ op: 'save-password', password: string } & DahliaSshTarget)
    | { op: 'delete-password', target: string }
    | { op: 'forget-host', host: string }

export interface DahliaSshSettings {
  /** The public key of this PC, when it has one. */
  publicKey?: string
  keyFile: string
  /** Logins with a saved password, as user@host:port. */
  passwords: string[]
  /** Hosts whose key is trusted, as host:port, with the key's SHA-256 fingerprint. */
  hosts: { host: string, fingerprint: string }[]
  /** Whether passwords can be saved (Windows' DPAPI, or the system keyring). */
  canSavePasswords: boolean
}

/** Where the key, the passwords and the host keys are kept, and how passwords are encrypted: swapped in tests. */
export interface DahliaSshStore {
  sshDirectory: string
  dataDirectory: string
  canEncrypt: () => boolean
  encrypt: (text: string) => string
  decrypt: (data: string) => string
}

function defaultStore(): DahliaSshStore {
  return {
    sshDirectory: path.join(os.homedir(), '.ssh'),
    dataDirectory: app.getPath('userData'),
    canEncrypt: () => safeStorage.isEncryptionAvailable(),
    encrypt: text => safeStorage.encryptString(text).toString('base64'),
    decrypt: data => safeStorage.decryptString(Buffer.from(data, 'base64')),
  }
}

/** A login's name in the password list: user@host:port, the host in lower case. */
export function sshTargetName(target: DahliaSshTarget): string {
  return `${target.user}@${target.host.trim().toLowerCase()}:${target.port || 22}`
}

/** "user@host:2222" or a host with the user apart: the target, or an error to tell her. */
export function parseSshTarget(input: { host?: unknown, user?: unknown, port?: unknown }): DahliaSshTarget | string {
  let host = typeof input.host === 'string' ? input.host.trim() : ''
  let user = typeof input.user === 'string' ? input.user.trim() : ''
  let port = Number(input.port) || undefined
  const at = host.lastIndexOf('@')
  if (at > 0) {
    user ||= host.slice(0, at)
    host = host.slice(at + 1)
  }
  const colon = /^([^:]+):(\d+)$/.exec(host)
  if (colon) {
    host = colon[1]
    port ??= Number(colon[2])
  }
  if (!host || !/^[\w.-]+$/.test(host))
    return 'Give the server as a host name or an IP address.'
  if (!user || !/^[\w.@-]+$/.test(user))
    return 'Give the user name to log in as.'
  if (port !== undefined && (port < 1 || port > 65535))
    return 'The port must be 1 to 65535.'
  return { host, user, port }
}

/** OpenSSH's fingerprint of a host key: SHA256: and the hash in Base64 without padding. */
export function sshFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

async function readJson<T extends object>(file: string): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  }
  catch {
    return {} as T
  }
}

async function writeJson(file: string, value: object) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 })
}

const passwordsFile = (store: DahliaSshStore) => path.join(store.dataDirectory, 'dahlia-ssh-passwords.json')
const hostsFile = (store: DahliaSshStore) => path.join(store.dataDirectory, 'dahlia-ssh-known-hosts.json')

/** The keys of this PC that need no passphrase, which the login can use. */
async function privateKeys(store: DahliaSshStore): Promise<ParsedKey[]> {
  const { utils } = await ssh2()
  const keys: ParsedKey[] = []
  for (const name of KEY_FILES) {
    const file = path.join(store.sshDirectory, name)
    if (!existsSync(file))
      continue
    const parsed = utils.parseKey(await readFile(file))
    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (key && !(key instanceof Error))
      keys.push(key)
  }
  return keys
}

/** This PC's public key line, made with its private key (~/.ssh/id_ed25519) when there is none. */
export async function ensureSshKey(store: DahliaSshStore = defaultStore(), create = true): Promise<string | undefined> {
  const { utils } = await ssh2()
  const file = path.join(store.sshDirectory, 'id_ed25519')
  if (existsSync(file)) {
    const pub = `${file}.pub`
    if (existsSync(pub))
      return (await readFile(pub, 'utf8')).trim()
    const parsed = utils.parseKey(await readFile(file))
    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (!key || key instanceof Error)
      return undefined
    return `${key.type} ${key.getPublicSSH().toString('base64')}`
  }
  if (!create)
    return undefined

  const pair = utils.generateKeyPairSync('ed25519', { comment: `dahlia@${os.hostname()}` })
  await mkdir(store.sshDirectory, { recursive: true, mode: 0o700 })
  await writeFile(file, pair.private, { mode: 0o600 })
  await writeFile(`${file}.pub`, `${pair.public.trim()}\n`, { mode: 0o644 })
  return pair.public.trim()
}

/** Keeps a login's password, encrypted. */
export async function saveSshPassword(target: DahliaSshTarget, password: string, store: DahliaSshStore = defaultStore()) {
  if (!store.canEncrypt())
    throw new Error('This PC can\'t encrypt passwords, so none is saved.')
  const passwords = await readJson<Record<string, string>>(passwordsFile(store))
  passwords[sshTargetName(target)] = store.encrypt(password)
  await writeJson(passwordsFile(store), passwords)
}

async function savedPassword(target: DahliaSshTarget, store: DahliaSshStore): Promise<string | undefined> {
  const saved = (await readJson<Record<string, string>>(passwordsFile(store)))[sshTargetName(target)]
  if (!saved)
    return undefined
  try {
    return store.decrypt(saved)
  }
  catch {
    return undefined
  }
}

/** The ways to log in, in order: this PC's keys, then the saved password (as a password and as keyboard-interactive). */
function authMethods(user: string, keys: ParsedKey[], password: string | undefined): AnyAuthMethod[] {
  const methods: AnyAuthMethod[] = keys.map(key => ({ type: 'publickey', username: user, key }))
  if (password !== undefined) {
    methods.push({ type: 'password', username: user, password })
    methods.push({
      type: 'keyboard-interactive',
      username: user,
      prompt: (_name: string, _instructions: string, _lang: string, prompts: Prompt[], finish: (answers: string[]) => void) => finish(prompts.map(() => password)),
    })
  }
  return methods
}

interface Connected {
  client: Client
  /** Said once in the output: the host key trusted on this first connection. */
  note?: string
}

/** Logs in, or throws with what to do about it. */
async function connect(target: DahliaSshTarget, store: DahliaSshStore, options: { keysOnly?: boolean } = {}): Promise<Connected> {
  const keys = await privateKeys(store)
  const password = options.keysOnly ? undefined : await savedPassword(target, store)
  const methods = authMethods(target.user, keys, password)
  const name = `${target.user}@${target.host}${target.port && target.port !== 22 ? `:${target.port}` : ''}`
  if (methods.length === 0)
    throw new Error(`There is no way to log in to ${name}: this PC has no key without a passphrase and no saved password. Create the key with ssh_key, or save the password in Settings > Dahlia > SSH on this PC.`)

  const hostName = `${target.host.toLowerCase()}:${target.port || 22}`
  const hosts = await readJson<Record<string, string>>(hostsFile(store))
  let note: string | undefined
  let mismatch: string | undefined

  const { Client: SshClient } = await ssh2()
  const client = new SshClient()
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve())
    client.once('error', (error: Error & { level?: string }) => {
      if (mismatch)
        reject(new Error(mismatch))
      else if (error.level === 'client-authentication')
        reject(new Error(`The login to ${name} was refused (${[keys.length > 0 ? 'this PC\'s key' : '', password !== undefined ? 'the saved password' : ''].filter(Boolean).join(' and ')}). Save the right password in Settings > Dahlia > SSH, or install this PC's key on the server with ssh_install_key.`))
      else
        reject(new Error(`${name} couldn't be reached: ${error.message}`))
    })
    let next = 0
    client.connect({
      host: target.host,
      port: target.port || 22,
      username: target.user,
      readyTimeout: CONNECT_TIMEOUT_MS,
      authHandler: (_left, _partial, done) => done(methods[next++] ?? false),
      hostVerifier: (key: Buffer) => {
        const fingerprint = sshFingerprint(key)
        const known = hosts[hostName]
        if (!known) {
          hosts[hostName] = fingerprint
          note = `First connection to ${hostName}: its host key ${fingerprint} is trusted from now on.`
          void writeJson(hostsFile(store), hosts)
          return true
        }
        if (known === fingerprint)
          return true
        mismatch = `The host key of ${hostName} changed (it was ${known}, now ${fingerprint}), so nothing was sent: someone may be in between. If the server was set up again, forget its key in Settings > Dahlia > SSH on this PC.`
        return false
      },
    })
  })
  return { client, note }
}

/** Runs a command over a connection: its output (stdout, then stderr) and exit code. */
function exec(client: Client, command: string, timeoutMs: number): Promise<DahliaSshResult> {
  return new Promise((resolve) => {
    client.exec(command, (error, stream) => {
      if (error) {
        resolve({ ok: false, exitCode: null, output: `The command couldn't start: ${error.message}` })
        return
      }
      let stdout = ''
      let stderr = ''
      let exitCode: number | null = null
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        stream.close()
      }, timeoutMs)
      stream.on('data', (chunk: Buffer) => stdout += chunk.toString('utf8'))
      stream.stderr.on('data', (chunk: Buffer) => stderr += chunk.toString('utf8'))
      stream.on('exit', (code: number | null) => exitCode = code)
      stream.on('close', () => {
        clearTimeout(timer)
        let output = stdout + (stderr ? `${stdout && !stdout.endsWith('\n') ? '\n' : ''}[stderr]\n${stderr}` : '')
        if (output.length > DAHLIA_SSH_MAX_OUTPUT)
          output = `${output.slice(0, DAHLIA_SSH_MAX_OUTPUT)}\n[output cut at ${DAHLIA_SSH_MAX_OUTPUT} characters]`
        if (timedOut)
          output += `\n[stopped after ${Math.round(timeoutMs / 1000)} seconds]`
        resolve({ ok: !timedOut && exitCode === 0, exitCode, output: output || '(no output)' })
      })
    })
  })
}

/** Answers one tool request. */
export async function runDahliaSsh(request: DahliaSshRequest, store: DahliaSshStore = defaultStore()): Promise<DahliaSshResult> {
  try {
    if (request.op === 'key') {
      const existed = existsSync(path.join(store.sshDirectory, 'id_ed25519'))
      const key = await ensureSshKey(store)
      if (!key)
        return { ok: false, exitCode: null, output: 'This PC\'s key (~/.ssh/id_ed25519) has a passphrase, so Dahlia can\'t use it. Save the server\'s password in Settings > Dahlia > SSH instead.' }
      return {
        ok: true,
        exitCode: 0,
        output: `${existed ? 'This PC\'s public key' : 'Made this PC\'s key (~/.ssh/id_ed25519). Its public key'}:\n${key}\n\nA server accepts it once this line is in ~/.ssh/authorized_keys of the user there: ssh_install_key adds it with the saved password.`,
      }
    }

    const target = parseSshTarget(request)
    if (typeof target === 'string')
      return { ok: false, exitCode: null, output: target }

    if (request.op === 'install_key') {
      const key = await ensureSshKey(store)
      if (!key)
        return { ok: false, exitCode: null, output: 'This PC\'s key has a passphrase, so it can\'t be installed for Dahlia.' }
      // The key line holds only Base64, its type and a host name, so single quotes keep it whole.
      const line = key.replace(/'/g, '')
      const command = `umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && (grep -qxF '${line}' ~/.ssh/authorized_keys || echo '${line}' >> ~/.ssh/authorized_keys) && echo installed`
      const { client, note } = await connect(target, store)
      let result: DahliaSshResult
      try {
        result = await exec(client, command, DEFAULT_TIMEOUT_MS)
      }
      finally {
        client.end()
      }
      if (!result.ok)
        return { ok: false, exitCode: result.exitCode, output: `The key couldn't be added (the server needs a POSIX shell): ${result.output}` }

      // The key alone must log in now.
      const check = await connect(target, store, { keysOnly: true }).then(({ client }) => client.end(), (error: Error) => error)
      const prefix = note ? `${note}\n` : ''
      return check instanceof Error
        ? { ok: false, exitCode: null, output: `${prefix}The key is in ~/.ssh/authorized_keys, but the server still refuses it: ${check.message}` }
        : { ok: true, exitCode: 0, output: `${prefix}This PC's key is installed for ${sshTargetName(target)}: logins need no password from now on.` }
    }

    const command = typeof request.command === 'string' ? request.command : ''
    if (!command.trim())
      return { ok: false, exitCode: null, output: 'Give the command to run.' }
    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, (Number(request.timeoutSeconds) || DEFAULT_TIMEOUT_MS / 1000) * 1000))
    const { client, note } = await connect(target, store)
    try {
      const result = await exec(client, command, timeoutMs)
      return note ? { ...result, output: `${note}\n${result.output}` } : result
    }
    finally {
      client.end()
    }
  }
  catch (error) {
    return { ok: false, exitCode: null, output: errorMessageFrom(error) ?? 'SSH failed.' }
  }
}

/** Answers Settings > Dahlia > SSH. A password goes in, never out. */
export async function dahliaSshSettings(request: DahliaSshSettingsRequest, store: DahliaSshStore = defaultStore()): Promise<DahliaSshSettings> {
  if (request.op === 'create-key') {
    await ensureSshKey(store)
  }
  else if (request.op === 'save-password') {
    const target = parseSshTarget(request)
    if (typeof target === 'string')
      throw new Error(target)
    if (!request.password)
      throw new Error('Type the password.')
    await saveSshPassword(target, request.password, store)
  }
  else if (request.op === 'delete-password') {
    const passwords = await readJson<Record<string, string>>(passwordsFile(store))
    delete passwords[request.target]
    await writeJson(passwordsFile(store), passwords)
  }
  else if (request.op === 'forget-host') {
    const hosts = await readJson<Record<string, string>>(hostsFile(store))
    delete hosts[request.host]
    await writeJson(hostsFile(store), hosts)
  }

  const hosts = await readJson<Record<string, string>>(hostsFile(store))
  return {
    publicKey: await ensureSshKey(store, false),
    keyFile: path.join(store.sshDirectory, 'id_ed25519'),
    passwords: Object.keys(await readJson<Record<string, string>>(passwordsFile(store))).sort(),
    hosts: Object.entries(hosts).map(([host, fingerprint]) => ({ host, fingerprint })).sort((a, b) => a.host.localeCompare(b.host)),
    canSavePasswords: store.canEncrypt(),
  }
}

/** Answers "dahlia:ssh" (Dahlia's tools) and "dahlia:ssh-settings" (the settings window). */
export function setupDahliaSsh() {
  ipcMain.handle(DAHLIA_SSH_CHANNEL, (_event, request: DahliaSshRequest) => runDahliaSsh(request))
  ipcMain.handle(DAHLIA_SSH_SETTINGS_CHANNEL, (_event, request: DahliaSshSettingsRequest) => dahliaSshSettings(request))
}
