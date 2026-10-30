// Dahlia: tests for dahlia-ssh.ts, SSH from the PC for Dahlia, against an SSH server of ssh2's in this process.
import type { AddressInfo } from 'node:net'

import type { ParsedKey } from 'ssh2'

import type { DahliaSshStore } from './dahlia-ssh'

import os from 'node:os'
import path from 'node:path'

import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'

import { Server, utils } from 'ssh2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dahliaSshSettings, ensureSshKey, parseSshTarget, runDahliaSsh, saveSshPassword, sshFingerprint } from './dahlia-ssh'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, ipcMain: { handle: vi.fn() }, safeStorage: {} }))

const USER = 'aleytia'
const PASSWORD = 'correct horse battery staple'

interface TestServer {
  port: number
  authorized: string[]
  close: () => Promise<void>
}

/** An SSH server for USER: the password (or keyboard-interactive only), the authorized keys, and a few commands. */
async function startServer(options: { keyboardOnly?: boolean, hostKey?: string } = {}): Promise<TestServer> {
  const authorized: string[] = []
  const hostKey = options.hostKey ?? utils.generateKeyPairSync('ed25519').private
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.username !== USER)
        return ctx.reject()
      if (ctx.method === 'password' && !options.keyboardOnly && ctx.password === PASSWORD)
        return ctx.accept()
      if (ctx.method === 'keyboard-interactive' && options.keyboardOnly) {
        return ctx.prompt([{ prompt: 'Password: ', echo: false }], answers => answers[0] === PASSWORD ? ctx.accept() : ctx.reject())
      }
      if (ctx.method === 'publickey') {
        const match = authorized.map(line => utils.parseKey(line)).find((key): key is ParsedKey =>
          !(key instanceof Error) && key.getPublicSSH().equals(ctx.key.data))
        if (match && (!ctx.signature || match.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true))
          return ctx.accept()
      }
      return ctx.reject(options.keyboardOnly ? ['keyboard-interactive', 'publickey'] : ['password', 'publickey'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        accept().on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec()
          const key = /grep -qxF '([^']+)'/.exec(info.command)
          if (key) {
            if (!authorized.includes(key[1]))
              authorized.push(key[1])
            stream.write('installed\n')
            stream.exit(0)
            stream.end()
          }
          else if (info.command === 'whoami') {
            stream.write(`${USER}\n`)
            stream.exit(0)
            stream.end()
          }
          else if (info.command === 'fail') {
            stream.write('partial\n')
            stream.stderr.write('something broke\n')
            stream.exit(3)
            stream.end()
          }
          // "sleep": never ends by itself.
        })
      })
    })
    client.on('error', () => {})
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    authorized,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

let directory: string
let store: DahliaSshStore
let server: TestServer | undefined

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'dahlia-ssh-'))
  store = {
    sshDirectory: path.join(directory, '.ssh'),
    dataDirectory: path.join(directory, 'data'),
    canEncrypt: () => true,
    encrypt: text => Buffer.from(`enc:${text}`).toString('base64'),
    decrypt: data => Buffer.from(data, 'base64').toString().replace(/^enc:/, ''),
  }
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(directory, { recursive: true, force: true })
})

describe('dahlia ssh', () => {
  it('reads the server as a host, user@host or user@host:port', () => {
    expect(parseSshTarget({ host: 'nas.local', user: 'root' })).toEqual({ host: 'nas.local', user: 'root', port: undefined })
    expect(parseSshTarget({ host: 'pi@192.168.10.20:2222' })).toEqual({ host: '192.168.10.20', user: 'pi', port: 2222 })
    expect(parseSshTarget({ host: 'nas; rm -rf /', user: 'root' })).toBe('Give the server as a host name or an IP address.')
    expect(parseSshTarget({ host: 'nas' })).toBe('Give the user name to log in as.')
  })

  it('writes a host key\'s fingerprint as OpenSSH does', () => {
    expect(sshFingerprint(Buffer.from('key'))).toMatch(/^SHA256:[\w+/]{43}$/)
  })

  it('makes this PC\'s key once, where ssh.exe looks for it', async () => {
    const first = await ensureSshKey(store)
    expect(first).toMatch(/^ssh-ed25519 \S+ dahlia@/)
    expect(existsSync(path.join(store.sshDirectory, 'id_ed25519'))).toBe(true)
    expect(await ensureSshKey(store)).toBe(first)
  })

  it('logs in with the saved password, trusts the host key the first time, and never shows the password', async () => {
    server = await startServer()
    await saveSshPassword({ host: '127.0.0.1', user: USER, port: server.port }, PASSWORD, store)

    const first = await runDahliaSsh({ op: 'run', host: '127.0.0.1', user: USER, port: server.port, command: 'whoami' }, store)
    expect(first).toMatchObject({ ok: true, exitCode: 0 })
    expect(first.output).toContain('its host key SHA256:')
    expect(first.output).toContain(`${USER}\n`)

    const second = await runDahliaSsh({ op: 'run', host: `${USER}@127.0.0.1:${server.port}`, user: '', command: 'whoami' }, store)
    expect(second.output).toBe(`${USER}\n`)
    expect(await readFile(path.join(store.dataDirectory, 'dahlia-ssh-passwords.json'), 'utf8')).not.toContain(PASSWORD)
  })

  it('answers a keyboard-interactive login with the saved password', async () => {
    server = await startServer({ keyboardOnly: true })
    await saveSshPassword({ host: '127.0.0.1', user: USER, port: server.port }, PASSWORD, store)

    const result = await runDahliaSsh({ op: 'run', host: '127.0.0.1', user: USER, port: server.port, command: 'whoami' }, store)

    expect(result).toMatchObject({ ok: true, exitCode: 0 })
  })

  it('says how to fix a refused login, without the password', async () => {
    server = await startServer()
    await saveSshPassword({ host: '127.0.0.1', user: USER, port: server.port }, 'wrong password', store)

    const result = await runDahliaSsh({ op: 'run', host: '127.0.0.1', user: USER, port: server.port, command: 'whoami' }, store)

    expect(result.ok).toBe(false)
    expect(result.output).toContain('was refused (the saved password)')
    expect(result.output).not.toContain('wrong password')
  })

  it('installs this PC\'s key with the password, after which the key alone logs in', async () => {
    server = await startServer()
    const target = { host: '127.0.0.1', user: USER, port: server.port }
    await saveSshPassword(target, PASSWORD, store)

    const installed = await runDahliaSsh({ op: 'install_key', ...target }, store)
    expect(installed).toMatchObject({ ok: true })
    expect(installed.output).toContain('logins need no password from now on')
    expect(server.authorized).toEqual([await ensureSshKey(store)])

    await dahliaSshSettings({ op: 'delete-password', target: `${USER}@127.0.0.1:${server.port}` }, store)
    const result = await runDahliaSsh({ op: 'run', ...target, command: 'whoami' }, store)
    expect(result).toMatchObject({ ok: true, output: `${USER}\n` })
  })

  it('refuses a server whose host key changed', async () => {
    server = await startServer()
    const target = { host: '127.0.0.1', user: USER, port: server.port }
    await saveSshPassword(target, PASSWORD, store)
    await runDahliaSsh({ op: 'run', ...target, command: 'whoami' }, store)
    await writeFile(path.join(store.dataDirectory, 'dahlia-ssh-known-hosts.json'), JSON.stringify({ [`127.0.0.1:${server.port}`]: 'SHA256:somethingelse' }))

    const result = await runDahliaSsh({ op: 'run', ...target, command: 'whoami' }, store)

    expect(result.ok).toBe(false)
    expect(result.output).toContain('The host key of 127.0.0.1:')
    expect(result.output).toContain('changed')
  })

  it('passes on the exit code and the errors, and stops a command at its time', async () => {
    server = await startServer()
    const target = { host: '127.0.0.1', user: USER, port: server.port }
    await saveSshPassword(target, PASSWORD, store)

    const failed = await runDahliaSsh({ op: 'run', ...target, command: 'fail' }, store)
    expect(failed).toMatchObject({ ok: false, exitCode: 3 })
    expect(failed.output).toContain('partial\n[stderr]\nsomething broke')

    const slow = await runDahliaSsh({ op: 'run', ...target, command: 'sleep', timeoutSeconds: 1 }, store)
    expect(slow.ok).toBe(false)
    expect(slow.output).toContain('[stopped after 1 seconds]')
  })

  it('lists logins and hosts for the settings, never a password', async () => {
    await saveSshPassword({ host: 'NAS.local', user: 'root' }, PASSWORD, store)
    const settings = await dahliaSshSettings({ op: 'create-key' }, store)

    expect(settings.passwords).toEqual(['root@nas.local:22'])
    expect(settings.publicKey).toMatch(/^ssh-ed25519 /)
    expect(JSON.stringify(settings)).not.toContain(PASSWORD)

    store.canEncrypt = () => false
    await expect(dahliaSshSettings({ op: 'save-password', host: 'pi', user: 'pi', password: 'x' }, store)).rejects.toThrow('can\'t encrypt')
  })
})
