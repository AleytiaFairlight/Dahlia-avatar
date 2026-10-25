// Dahlia: the voice detection worker uses the apps' own copies of ONNX Runtime and of the Silero VAD model
// (dahlia-assets/, put there by scripts/dahlia-vad-assets.mjs before a build) instead of loading them from
// cdn.jsdelivr.net and huggingface.co, which the apps may not reach. Without the copies, transformers.js keeps
// its defaults. This file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh imports it in
// silero-vad-model.ts.

import { env } from '@huggingface/transformers'

/** The Silero VAD model's file as transformers.js asks for it. */
export const SILERO_VAD_MODEL_FILE = /onnx-community\/silero-vad\/.*onnx\/model\.onnx$/

const assets = import.meta.glob<string>('./dahlia-assets/*', { query: '?url', import: 'default', eager: true })

function asset(name: string): string | undefined {
  return assets[`./dahlia-assets/${name}`]
}

const runtime = { mjs: asset('ort-wasm-simd-threaded.jsep.mjs'), wasm: asset('ort-wasm-simd-threaded.jsep.wasm') }
const model = asset('silero-vad.onnx')

if (runtime.mjs && runtime.wasm && env.backends.onnx.wasm)
  env.backends.onnx.wasm.wasmPaths = { mjs: runtime.mjs, wasm: runtime.wasm }

if (model) {
  // A cache that has the model: transformers.js asks its cache before the network.
  env.useCustomCache = true
  env.customCache = {
    match: async (request: string | Request) => {
      const url = typeof request === 'string' ? request : request.url
      return SILERO_VAD_MODEL_FILE.test(url) ? await fetch(model) : undefined
    },
    put: async () => {},
  }
}
