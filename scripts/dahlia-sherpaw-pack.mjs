#!/usr/bin/env node
// Dahlia: builds the Sherpaw pack of Dahlia's English speech model (packages/provider-inference/src/
// providers/local/sherpaw-transcription/dahlia-models.ts) from sherpa-onnx's release, into the download
// cache that the apps' Sherpaw Vite plugin reads (.cache/sherpaw/<id>/<revision>). The plugin then finds
// the pack and bundles it instead of downloading it. This file is Dahlia's (AIRI has no such file).
//
//   node scripts/dahlia-sherpaw-pack.mjs
//
// A pack is Emscripten's file packager format: the model files one after another in preload.data, and
// their places in preload.js.metadata.

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const model = 'sherpa-onnx-streaming-zipformer-en-2023-06-26'
const id = 'zipformer-en-2023-06-26-int8'
const revision = 'dahlia-1'
const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${model}.tar.bz2`
// The decoder has no INT8 copy that works as well; the encoder is most of the size.
const files = {
  '/encoder.onnx': 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
  '/decoder.onnx': 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
  '/joiner.onnx': 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
  '/tokens.txt': 'tokens.txt',
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, '.cache', 'sherpaw', id, revision)

/** GitHub sends each connection slowly; eight parts at once are several times faster. */
async function download(target) {
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  const size = Number(head.headers.get('content-length'))
  if (!head.ok || !size)
    throw new Error(`${url} answered ${head.status}`)

  const parts = 8
  const chunks = await Promise.all(Array.from({ length: parts }, async (_, i) => {
    const start = Math.floor(i * size / parts)
    const end = Math.floor((i + 1) * size / parts) - 1
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(head.url, { headers: { Range: `bytes=${start}-${end}` } })
        if (response.status !== 206)
          throw new Error(`a part answered ${response.status}`)
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length !== end - start + 1)
          throw new Error('a part came incomplete')
        return bytes
      }
      catch (error) {
        if (attempt >= 3)
          throw error
      }
    }
  }))
  await writeFile(target, Buffer.concat(chunks))
}

async function main() {
  if (existsSync(join(output, 'preload.data')) && existsSync(join(output, 'preload.js.metadata'))) {
    console.info(`dahlia-sherpaw-pack: ${id} is already in the cache`)
    return
  }

  const work = await mkdtemp(join(tmpdir(), 'dahlia-pack-'))
  try {
    console.info(`dahlia-sherpaw-pack: downloading ${model}`)
    const archive = join(work, 'model.tar.bz2')
    await download(archive)
    // Relative paths: GNU tar on Windows reads "C:" in a path as a remote host.
    execFileSync('tar', ['-xjf', 'model.tar.bz2', ...Object.values(files).map(name => `${model}/${name}`)], { cwd: work, stdio: 'inherit' })

    const metadata = { files: [], remote_package_size: 0 }
    const contents = []
    for (const [filename, name] of Object.entries(files)) {
      const bytes = await readFile(join(work, model, name))
      metadata.files.push({ filename, start: metadata.remote_package_size, end: metadata.remote_package_size + bytes.length })
      metadata.remote_package_size += bytes.length
      contents.push(bytes)
    }

    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'preload.data.tmp'), Buffer.concat(contents))
    await writeFile(join(output, 'preload.js.metadata'), JSON.stringify(metadata))
    await rename(join(output, 'preload.data.tmp'), join(output, 'preload.data'))
    console.info(`dahlia-sherpaw-pack: ${id} (${Math.round(metadata.remote_package_size / 1048576)} MB) is in ${output}`)
  }
  finally {
    await rm(work, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('dahlia-sherpaw-pack:', error)
  process.exit(1)
})
