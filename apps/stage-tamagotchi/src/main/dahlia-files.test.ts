// Dahlia: tests for dahlia-files.ts and resources/dahlia-files-mcp.mjs, Dahlia's read-only file server.
import process from 'node:process'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The server is a plain script for Node, so its file name has to be imported as it is.
// eslint-disable-next-line no-restricted-syntax
import { createTools, handle } from '../../resources/dahlia-files-mcp.mjs'
import { DAHLIA_FILES_SERVER, withDahliaFilesServer } from './dahlia-files'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../../resources/dahlia-files-mcp.mjs?asset&asarUnpack', () => ({ default: '/app/resources/dahlia-files-mcp.mjs' }))

const SCRIPT = fileURLToPath(new URL('../../resources/dahlia-files-mcp.mjs', import.meta.url))

describe('dahlia file server entry in mcp.json', () => {
  const read = (text: string | undefined) => JSON.parse(text!).mcpServers[DAHLIA_FILES_SERVER]

  it('is added once, running the app itself in Node mode', () => {
    const text = withDahliaFilesServer('{"mcpServers":{}}', 'C:\\Dahlia\\Dahlia.exe', 'C:\\Dahlia\\resources\\app.asar.unpacked\\x.mjs', true)

    expect(read(text)).toEqual({
      command: 'C:\\Dahlia\\Dahlia.exe',
      args: ['C:\\Dahlia\\resources\\app.asar.unpacked\\x.mjs'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(withDahliaFilesServer('{"mcpServers":{}}', 'a', 'b', false)).toBeUndefined()
  })

  it('keeps the user\'s folders and switch, and only updates the paths', () => {
    const config = JSON.stringify({ mcpServers: { [DAHLIA_FILES_SERVER]: { command: 'old.exe', args: ['old.mjs', 'D:\\Photos'], env: { ELECTRON_RUN_AS_NODE: '1' }, enabled: false } } })

    expect(read(withDahliaFilesServer(config, 'new.exe', 'new.mjs', false))).toEqual({
      command: 'new.exe',
      args: ['new.mjs', 'D:\\Photos'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      enabled: false,
    })
    expect(withDahliaFilesServer(config, 'old.exe', 'old.mjs', false)).toBeUndefined()
  })

  it('leaves a broken file alone', () => {
    expect(withDahliaFilesServer('{ not json', 'a', 'b', true)).toBeUndefined()
  })
})

// The server is plain JavaScript, so its arguments and answers have no types of their own.
type Tools = Record<string, { run: (args: Record<string, unknown>) => Promise<string> }>
interface Answer { result: { tools: { name: string }[], isError?: boolean } }

describe('dahlia file server', () => {
  let base: string
  let shared: string
  let tools: Tools

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'dahlia-files-'))
    shared = join(base, 'Documents')
    await mkdir(join(shared, 'Taxes', '2025'), { recursive: true })
    await mkdir(join(shared, 'node_modules', 'pkg'), { recursive: true })
    await mkdir(join(base, 'Private'), { recursive: true })
    await writeFile(join(shared, 'Taxes', '2025', 'Tax return 2025.txt'), 'Refund: 412 EUR\nFiled in March\n')
    await writeFile(join(shared, 'Taxes', 'receipt.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 1, 2]))
    await writeFile(join(shared, 'shopping.md'), '- milk\n- refund the jacket\n')
    await writeFile(join(shared, 'node_modules', 'pkg', 'refund.txt'), 'refund')
    await writeFile(join(base, 'Private', 'secret.txt'), 'refund secret')
    await symlink(join(base, 'Private'), join(shared, 'link-to-private'))
    tools = createTools([shared])
  })

  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('finds files by words or a pattern', async () => {
    const byWords = await tools.find_files.run({ query: 'tax 2025' })
    expect(byWords).toContain(join(shared, 'Taxes', '2025', 'Tax return 2025.txt'))
    expect(byWords).toContain(`${join(shared, 'Taxes', '2025')}`)

    const byPattern = await tools.find_files.run({ query: '*.pdf' })
    expect(byPattern).toContain('receipt.pdf')
    expect(byPattern).not.toContain('.txt')
    expect(await tools.find_files.run({ query: 'tax*2025' })).toContain('Tax return 2025.txt')
  })

  it('finds text inside text files, not in binaries, program folders or other folders', async () => {
    const found = await tools.search_text.run({ text: 'REFUND' })

    expect(found).toContain(`${join(shared, 'Taxes', '2025', 'Tax return 2025.txt')}:1: Refund: 412 EUR`)
    expect(found).toContain(`${join(shared, 'shopping.md')}:2: - refund the jacket`)
    expect(found).not.toContain('node_modules')
    expect(found).not.toContain('secret')
  })

  it('reads a text file and refuses a binary one', async () => {
    expect(await tools.read_file.run({ path: join(shared, 'shopping.md') })).toBe('- milk\n- refund the jacket\n')
    await expect(tools.read_file.run({ path: join(shared, 'Taxes', 'receipt.pdf') })).rejects.toThrow('not a text file')
  })

  it('reads nothing outside the shared folders, also through a link', async () => {
    await expect(tools.read_file.run({ path: join(base, 'Private', 'secret.txt') })).rejects.toThrow('not in a folder Dahlia may read')
    await expect(tools.read_file.run({ path: join(shared, 'link-to-private', 'secret.txt') })).rejects.toThrow('not in a folder Dahlia may read')
    await expect(tools.list_directory.run({ path: join(shared, '..') })).rejects.toThrow('not in a folder Dahlia may read')
  })

  it('answers MCP requests and reports tool errors as results', async () => {
    const list = await handle(tools, { jsonrpc: '2.0', id: 1, method: 'tools/list' }) as Answer
    expect(list.result.tools.map(t => t.name)).toEqual(['list_folders', 'list_directory', 'find_files', 'search_text', 'read_file', 'file_info'])

    const failed = await handle(tools, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_file', arguments: { path: '/etc/passwd' } } }) as Answer
    expect(failed.result.isError).toBe(true)
    expect(await handle(tools, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined()
  })

  it('runs as a stdio server', async () => {
    const child = spawn(process.execPath, [SCRIPT, shared], { stdio: ['pipe', 'pipe', 'inherit'] })
    const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]()
    const ask = async (message: object) => {
      child.stdin!.write(`${JSON.stringify(message)}\n`)
      return JSON.parse((await lines.next()).value ?? 'null')
    }

    const init = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    const folders = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_folders', arguments: {} } })
    child.kill()

    expect(init.result.serverInfo.name).toBe('dahlia-files')
    expect(folders.result.content[0].text).toBe(shared)
  })

  it('a file of the expected shape is written to mcp.json', async () => {
    const config = join(base, 'mcp.json')
    await writeFile(config, `${withDahliaFilesServer('{}', process.execPath, SCRIPT, true)}`)
    expect(JSON.parse(await readFile(config, 'utf-8')).mcpServers[DAHLIA_FILES_SERVER].args).toEqual([SCRIPT])
  })
})
