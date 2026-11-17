import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DisplayModelFormat, useDisplayModelsStore } from './display-models'

const records = vi.hoisted(() => new Map<string, unknown>())
const listDeviceKeys = vi.hoisted(() => vi.fn(() => [...records.keys()]))

// Node has no IndexedDB. The `device` mount reads and writes `records` instead.
// IndexedDB returns a copy of each record, so a change is not visible until a write.
vi.mock('../database/storage', async (importOriginal) => {
  const { createStorage } = await import('unstorage')
  const storage = createStorage()
  const read = (key: string) => records.has(key) ? { ...records.get(key) as object } : null
  storage.mount('device', {
    name: 'device-records',
    hasItem: key => records.has(key),
    getItem: read,
    getItemRaw: read,
    setItemRaw: (key, value) => {
      records.set(key, value)
    },
    removeItem: (key) => {
      records.delete(key)
    },
    getKeys: listDeviceKeys,
    clear: () => records.clear(),
  })
  return { ...await importOriginal<typeof import('../database/storage')>(), storage }
})

describe('display models store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    records.clear()
  })

  it('resolves newly imported display models from memory before IndexedDB', async () => {
    const store = useDisplayModelsStore()
    const model = {
      id: 'display-model-pending-idb-write',
      format: DisplayModelFormat.VRM,
      type: 'file' as const,
      file: new File(['model'], 'model.zip'),
      name: 'model.zip',
      importedAt: 1,
    }

    store.displayModels = [model]

    const resolved = await store.getDisplayModel(model.id)

    expect(resolved).toEqual(model)
  })

  it('loads stored models once when several callers initialize at the same time', async () => {
    const store = useDisplayModelsStore()

    await Promise.all([
      store.loadDisplayModelsFromIndexedDB(),
      store.loadDisplayModelsFromIndexedDB(),
      store.loadDisplayModelsFromIndexedDB(),
    ])

    expect(listDeviceKeys).toHaveBeenCalledTimes(1)
  })
})
