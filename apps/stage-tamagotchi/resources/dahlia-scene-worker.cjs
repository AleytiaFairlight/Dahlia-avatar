// Dahlia: runs the scene model (Mirage, on the Cactus WebAssembly runtime) off the main thread, so a look at a
// picture, which takes a second or more, never holds up the app's windows. src/main/dahlia-scene-model.ts starts
// it as a worker thread with the folder that holds cactus.js, cactus.wasm and mirage.cact, and sends it pictures
// as packed RGB bytes; it answers with the model's JSON. Plain CommonJS on purpose: it is loaded as a file, not
// bundled. This file is Dahlia's (AIRI has no such file).
const fs = require('node:fs')
const path = require('node:path')
const { parentPort, workerData } = require('node:worker_threads')

const OUT_BYTES = 256 * 1024
let ready

function load() {
  ready ??= (async () => {
    const dir = workerData.dir
    const source = fs.readFileSync(path.join(dir, 'cactus.js'), 'utf8')
    // The runtime's loader is a script that defines createCactus; it is checked by hash before it gets here.
    // eslint-disable-next-line no-new-func
    const createCactus = new Function('require', '__dirname', '__filename', `${source}\nreturn createCactus;`)(require, dir, path.join(dir, 'cactus.js'))
    const cactus = await createCactus({ wasmBinary: fs.readFileSync(path.join(dir, 'cactus.wasm')) })
    const weights = fs.readFileSync(path.join(dir, 'mirage.cact'))
    const pointer = cactus._malloc(weights.length)
    cactus.HEAPU8.set(weights, pointer)
    const code = cactus._cactus_load(pointer, BigInt(weights.length))
    cactus._free(pointer)
    if (code !== 0)
      throw new Error(`The scene model didn't load (${code}).`)
    return cactus
  })()
  return ready
}

parentPort.on('message', async (message) => {
  try {
    const cactus = await load()
    if (message.op === 'load') {
      parentPort.postMessage({ id: message.id, ok: true })
      return
    }
    const rgb = new Uint8Array(message.rgb)
    if (rgb.length !== message.width * message.height * 3)
      throw new Error('The picture isn\'t packed RGB of the size given.')
    const picture = cactus._malloc(rgb.length)
    const out = cactus._malloc(OUT_BYTES)
    try {
      cactus.HEAPU8.set(rgb, picture)
      const started = Date.now()
      const code = cactus._cactus_describe(picture, message.width, message.height, 0, 0, 0, out, OUT_BYTES)
      if (code < 0)
        throw new Error(`The scene model failed (${code}).`)
      parentPort.postMessage({ id: message.id, ok: true, json: cactus.UTF8ToString(out), ms: Date.now() - started })
    }
    finally {
      cactus._free(picture)
      cactus._free(out)
    }
  }
  catch (error) {
    parentPort.postMessage({ id: message.id, ok: false, error: String(error && error.message ? error.message : error) })
  }
})
