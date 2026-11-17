import type { DisplayModelFile } from '../../stores/display-models'

import localforage from 'localforage'
import indexedDbDriver from 'unstorage/drivers/indexedb'

import { createStorage } from 'unstorage'
import { afterEach, expect, it } from 'vitest'

import { DisplayModelFormat } from '../../stores/display-models'
import { createDisplayModelsRepo } from './display-models.repo'

// Browser test files share one origin and one IndexedDB. Remove only the keys that this test writes.
const dbName = 'airi-display-models-browser-test'
const store = createStorage({ driver: indexedDbDriver({ dbName, storeName: 'keyvaluepairs' }) })
// Releases before the unstorage migration wrote records with localforage. It uses the store name `keyvaluepairs` by default.
const previousRelease = localforage.createInstance({ name: dbName })
const id = 'display-model-browser-test'

async function sha256Hex(blob: Blob) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

function bytes(size: number) {
  const data = new Uint8Array(size)
  for (let index = 0; index < size; index++)
    data[index] = (index * 31 + 7) % 251
  return data
}

afterEach(async () => {
  await store.removeItem(id)
})

it('reads a model that the previous release wrote, with the same bytes', async () => {
  const content = bytes(1024 * 1024)
  await previousRelease.setItem(id, {
    format: DisplayModelFormat.VRM,
    file: new File([content], 'avatar.vrm', { type: 'model/gltf-binary' }),
    importedAt: 1,
  })

  const [listed] = await createDisplayModelsRepo(store).list()

  expect(listed).toMatchObject({ id, type: 'file', name: 'avatar.vrm', format: DisplayModelFormat.VRM })
  // Compare digests. `toEqual` checks a byte array one element at a time, and 4 MiB took 5 seconds in Node.
  expect(listed.file.size).toBe(content.byteLength)
  expect(await sha256Hex(listed.file)).toBe(await sha256Hex(new Blob([content])))
})

it('keeps a saved model across repository instances', async () => {
  const model: DisplayModelFile = { id, format: DisplayModelFormat.VRM, type: 'file', file: new File(['zip'], 'model.zip'), name: 'Renamed', importedAt: 1 }
  await createDisplayModelsRepo(store).save(model)

  const repo = createDisplayModelsRepo(store)

  expect(await repo.list()).toMatchObject([{ id, name: 'Renamed' }])
  expect(await (await repo.get(id))!.file.text()).toBe('zip')
})
