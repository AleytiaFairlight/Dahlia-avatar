// Dahlia: a read-only MCP server (stdio) that lets Dahlia look up and read files on this computer. This
// file is Dahlia's (AIRI has no such file). The desktop app starts it with its own executable in Node mode
// (ELECTRON_RUN_AS_NODE), so Windows needs nothing installed; src/main/dahlia-files.ts adds it to mcp.json.
//
//   node dahlia-files-mcp.mjs [folder ...]
//
// Only the folders given (by default the user's Desktop, Documents, Downloads, Pictures, Music, Videos and
// OneDrive) and what is inside them can be listed and read. Nothing is ever written, moved or deleted.

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const VERSION = '1.0.0'
const MAX_RESULTS = 100
const MAX_VISITED = 50_000
const SEARCH_SECONDS = 20
const MAX_READ_CHARS = 30_000
const MAX_SEARCH_BYTES = 5 * 1024 * 1024
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

// Folders that searches skip: program caches and system folders hold nothing a person looks for.
const SKIPPED_FOLDERS = new Set(['node_modules', '$recycle.bin', 'system volume information', '__pycache__', 'appdata'])

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.jsonc',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.log',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.py',
  '.cs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.lua',
  '.srt',
  '.vtt',
  '.tex',
  '.rtf',
])

export function defaultFolders(home = homedir()) {
  return ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'OneDrive'].map(name => join(home, name))
}

/** The allowed folders that exist, with their real paths. */
export async function resolveRoots(folders) {
  const roots = []
  for (const folder of folders) {
    try {
      const real = await realpath(resolve(folder))
      if ((await stat(real)).isDirectory() && !roots.includes(real))
        roots.push(real)
    }
    catch {}
  }
  return roots
}

function isInside(root, path) {
  const rel = relative(CASE_INSENSITIVE ? root.toLowerCase() : root, CASE_INSENSITIVE ? path.toLowerCase() : path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The real path of `path` when it is inside an allowed folder; a relative path is looked up in each. */
export async function allowedPath(roots, path) {
  if (typeof path !== 'string' || path.trim() === '')
    throw new Error('A path is required.')

  const candidates = isAbsolute(path) ? [path] : roots.map(root => join(root, path))
  for (const candidate of candidates) {
    let real
    try {
      real = await realpath(resolve(candidate))
    }
    catch {
      continue
    }
    // realpath follows links, so a link can't lead outside the allowed folders.
    if (roots.some(root => isInside(root, real)))
      return real
  }
  throw new Error(`${path} is not in a folder Dahlia may read, or it doesn't exist. Folders: ${roots.join(', ')}`)
}

function formatSize(bytes) {
  if (bytes < 1024)
    return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

function formatEntry(path, info) {
  return info.isDirectory()
    ? `${path}${sep} (folder)`
    : `${path} (${formatSize(info.size)}, modified ${info.mtime.toISOString().slice(0, 16).replace('T', ' ')})`
}

/** A matcher for file names: a pattern with * or ?, or words that must all appear in the name. */
export function nameMatcher(query) {
  const text = String(query ?? '').trim().toLowerCase()
  if (text === '')
    throw new Error('Say what to look for.')
  if (/[*?]/.test(text)) {
    const pattern = new RegExp(`^${text.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
    // "invoice*october" finds invoice-october.txt: the pattern may leave out the extension.
    return (name) => {
      const lower = name.toLowerCase()
      return pattern.test(lower) || pattern.test(lower.slice(0, lower.length - extname(lower).length))
    }
  }
  const words = text.split(/\s+/)
  return name => words.every(word => name.toLowerCase().includes(word))
}

/** Walks the folders breadth first, calling visit(path, dirent) for each entry, within the limits. */
async function walk(folders, visit) {
  const deadline = Date.now() + SEARCH_SECONDS * 1000
  const queue = [...folders]
  let visited = 0
  while (queue.length > 0) {
    if (Date.now() > deadline || visited > MAX_VISITED)
      return false
    const folder = queue.shift()
    let entries
    try {
      entries = await readdir(folder, { withFileTypes: true })
    }
    catch {
      continue
    }
    for (const entry of entries) {
      visited++
      if (entry.name.startsWith('.') || entry.isSymbolicLink())
        continue
      const path = join(folder, entry.name)
      if (await visit(path, entry) === false)
        return true
      if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name.toLowerCase()))
        queue.push(path)
    }
  }
  return true
}

async function looksLikeText(path) {
  if (TEXT_EXTENSIONS.has(extname(path).toLowerCase()))
    return true
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return !buffer.subarray(0, bytesRead).includes(0)
  }
  finally {
    await handle.close()
  }
}

/**
 * The server's tools, by name.
 *
 * @param {string[]} roots The allowed folders, as real paths.
 * @returns {Record<string, { description: string, inputSchema: object, run: (args: Record<string, any>) => Promise<string> }>} The tools, by name.
 */
export function createTools(roots) {
  const searchFolders = async folder => folder ? [await allowedPath(roots, folder)] : roots

  return {
    list_folders: {
      description: 'List the folders on this computer that you may look in. Every path you use must be in one of them.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => roots.length > 0 ? roots.join('\n') : 'No folders are shared.',
    },
    list_directory: {
      description: 'List what a folder contains: subfolders, and files with their size and when they changed.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The folder, as a full path' } }, required: ['path'] },
      run: async ({ path }) => {
        const folder = await allowedPath(roots, path)
        const entries = (await readdir(folder, { withFileTypes: true })).filter(entry => !entry.name.startsWith('.'))
        const lines = []
        for (const entry of entries.slice(0, 300)) {
          try {
            lines.push(formatEntry(join(folder, entry.name), await stat(join(folder, entry.name))))
          }
          catch {}
        }
        if (entries.length > 300)
          lines.push(`… and ${entries.length - 300} more`)
        return lines.length > 0 ? lines.join('\n') : `${folder} is empty.`
      },
    },
    find_files: {
      description: 'Find files and folders by name, in all shared folders or in one. Use words from the name ("tax 2025") or a pattern ("*.pdf", "invoice*.docx").',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words from the name, or a pattern with * and ?' },
          folder: { type: 'string', description: 'Only look in this folder (optional)' },
        },
        required: ['query'],
      },
      run: async ({ query, folder }) => {
        const matches = nameMatcher(query)
        const found = []
        const complete = await walk(await searchFolders(folder), async (path, entry) => {
          if (!matches(entry.name))
            return
          try {
            found.push(formatEntry(path, await stat(path)))
          }
          catch {}
          return found.length < MAX_RESULTS
        })
        if (found.length === 0)
          return complete ? `Nothing named like "${query}" was found.` : `Nothing named like "${query}" was found in the time allowed; try a smaller folder.`
        return found.join('\n') + (found.length >= MAX_RESULTS ? `\n(the first ${MAX_RESULTS} found)` : '')
      },
    },
    search_text: {
      description: 'Find text inside text files (notes, documents in plain text, code, CSV, logs). Returns the matching lines. Not for PDF or Word files.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to find (any letter case)' },
          folder: { type: 'string', description: 'Only look in this folder (optional)' },
          file_pattern: { type: 'string', description: 'Only files named like this, such as "*.md" (optional)' },
        },
        required: ['text'],
      },
      run: async ({ text, folder, file_pattern: filePattern }) => {
        const needle = String(text ?? '').toLowerCase()
        if (needle === '')
          throw new Error('Say what text to find.')
        const nameMatches = filePattern ? nameMatcher(filePattern) : () => true
        const found = []
        const complete = await walk(await searchFolders(folder), async (path, entry) => {
          if (!entry.isFile() || !nameMatches(entry.name))
            return
          try {
            if ((await stat(path)).size > MAX_SEARCH_BYTES || !await looksLikeText(path))
              return
            const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
            let number = 0
            for await (const line of lines) {
              number++
              if (line.toLowerCase().includes(needle)) {
                found.push(`${path}:${number}: ${line.trim().slice(0, 200)}`)
                if (found.length >= MAX_RESULTS) {
                  lines.close()
                  return false
                }
              }
            }
          }
          catch {}
        })
        if (found.length === 0)
          return complete ? `"${text}" was not found.` : `"${text}" was not found in the time allowed; try a smaller folder or a file pattern.`
        return found.join('\n') + (found.length >= MAX_RESULTS ? `\n(the first ${MAX_RESULTS} matches)` : '')
      },
    },
    read_file: {
      description: `Read a text file. Long files come in parts of ${MAX_READ_CHARS} characters; pass offset to read further.`,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file, as a full path' },
          offset: { type: 'number', description: 'Character to start at (optional)' },
        },
        required: ['path'],
      },
      run: async ({ path, offset = 0 }) => {
        const file = await allowedPath(roots, path)
        const info = await stat(file)
        if (!info.isFile())
          throw new Error(`${file} is a folder; use list_directory.`)
        if (!await looksLikeText(file))
          throw new Error(`${file} is not a text file (${extname(file) || 'no extension'}, ${formatSize(info.size)}); it can't be read as text.`)
        if (info.size > 50 * 1024 * 1024)
          throw new Error(`${file} is too large to read (${formatSize(info.size)}).`)

        const content = await readFile(file, 'utf8')
        const start = Math.max(0, Math.floor(Number(offset) || 0))
        const part = content.slice(start, start + MAX_READ_CHARS)
        const end = start + part.length
        return end < content.length
          ? `${part}\n\n[characters ${start}-${end} of ${content.length}; read on with offset ${end}]`
          : part
      },
    },
    file_info: {
      description: 'Show a file\'s or folder\'s size and when it was created and changed.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The file or folder, as a full path' } }, required: ['path'] },
      run: async ({ path }) => {
        const file = await allowedPath(roots, path)
        const info = await stat(file)
        return [
          `${file}`,
          `type: ${info.isDirectory() ? 'folder' : 'file'}`,
          info.isDirectory() ? undefined : `size: ${formatSize(info.size)} (${info.size} bytes)`,
          `created: ${info.birthtime.toISOString()}`,
          `modified: ${info.mtime.toISOString()}`,
        ].filter(Boolean).join('\n')
      },
    },
  }
}

/** Answers one JSON-RPC message; returns the reply, or undefined for a notification. */
export async function handle(tools, message) {
  const reply = result => ({ jsonrpc: '2.0', id: message.id, result })
  const fail = (code, text) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: text } })
  if (message.id === undefined || message.id === null)
    return undefined

  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'dahlia-files', version: VERSION },
        instructions: 'Read-only access to files in the folders that list_folders names.',
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({
        tools: Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: true } })),
      })
    case 'tools/call': {
      const tool = tools[message.params?.name]
      if (!tool)
        return fail(-32602, `Unknown tool: ${message.params?.name}`)
      try {
        return reply({ content: [{ type: 'text', text: await tool.run(message.params?.arguments ?? {}) }] })
      }
      catch (error) {
        return reply({ content: [{ type: 'text', text: String(error?.message ?? error) }], isError: true })
      }
    }
    default:
      return fail(-32601, `Method not found: ${message.method}`)
  }
}

async function main() {
  const folders = process.argv.slice(2)
  const tools = createTools(await resolveRoots(folders.length > 0 ? folders : defaultFolders()))
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    if (line.trim() === '')
      continue
    let message
    try {
      message = JSON.parse(line)
    }
    catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`)
      continue
    }
    // Calls run one after another, so replies keep their order and a search can't starve the others.
    const answer = await handle(tools, message)
    if (answer)
      process.stdout.write(`${JSON.stringify(answer)}\n`)
  }
}

// Runs when started as a program (the build gives the file a hashed name), not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
