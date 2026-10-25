#!/usr/bin/env node
// Dahlia: puts the voice detection's files into the apps (packages/stage-ui/src/workers/vad/dahlia-assets/):
// ONNX Runtime's WebAssembly files from @huggingface/transformers and the Silero VAD model. transformers.js
// would load them from cdn.jsdelivr.net and huggingface.co, which the apps may not reach (they connect only to
// Dahlia's server), so voice input failed with "no available backend found". The worker uses these copies
// (workers/vad/dahlia-silero-assets.ts). This file is Dahlia's (AIRI has no such file).
//
//   node scripts/dahlia-vad-assets.mjs
//
// The release workflow runs it before the apps are built. Without the files the apps fall back to AIRI's
// behaviour, which works only with a connection to those hosts.

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'packages', 'stage-ui', 'src', 'workers', 'vad', 'dahlia-assets')

// onnx-community/silero-vad at a fixed revision, checked by its SHA-256.
const MODEL_URL = 'https://huggingface.co/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx'
const MODEL_SHA256 = 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808'
const RUNTIME_FILES = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function main() {
  await mkdir(output, { recursive: true })

  // The node entry resolves next to the web build's files in dist/.
  const require = createRequire(join(root, 'packages', 'stage-ui', 'package.json'))
  const dist = dirname(require.resolve('@huggingface/transformers'))
  for (const file of RUNTIME_FILES)
    await copyFile(join(dist, file), join(output, file))

  const model = join(output, 'silero-vad.onnx')
  const existing = await readFile(model).catch(() => undefined)
  if (existing && sha256(existing) === MODEL_SHA256) {
    console.info(`Dahlia's voice detection files are in ${output} (the model was there already).`)
    return
  }

  const response = await fetch(MODEL_URL, { redirect: 'follow' })
  if (!response.ok)
    throw new Error(`The Silero VAD model download answered ${response.status}.`)
  const data = Buffer.from(await response.arrayBuffer())
  if (sha256(data) !== MODEL_SHA256)
    throw new Error('The Silero VAD model download has the wrong SHA-256.')
  await writeFile(model, data)
  console.info(`Dahlia's voice detection files are in ${output}.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
