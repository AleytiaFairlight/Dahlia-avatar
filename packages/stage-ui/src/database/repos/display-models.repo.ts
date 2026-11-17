import type { Storage } from 'unstorage'

import type { DisplayModelFile } from '../../stores/display-models'

import { prefixStorage } from 'unstorage'

import { listRawItems, storage } from '../storage'

type StoredDisplayModel = Omit<DisplayModelFile, 'id' | 'type' | 'name'> & { name?: string }

const modelPrefix = 'display-model-'

/** Earlier releases did not store the id, type, or name. The key and the file name give them. */
function fromStored(id: string, value: StoredDisplayModel): DisplayModelFile {
  return { ...value, id, type: 'file', name: value.name ?? value.file.name }
}

/**
 * Device storage for imported display models.
 * Models keep the keys that earlier releases wrote, so existing imports stay in place.
 */
export function createDisplayModelsRepo(store: Storage) {
  return {
    async list() {
      const models = await listRawItems<StoredDisplayModel>(store, modelPrefix)
      return models.map(([id, value]) => fromStored(id, value))
    },

    async get(id: string) {
      const value = await store.getItemRaw<StoredDisplayModel>(id)
      return value ? fromStored(id, value) : undefined
    },

    async save(model: DisplayModelFile) {
      await store.setItemRaw(model.id, model)
    },

    async remove(id: string) {
      await store.removeItem(id)
    },
  }
}

export const displayModelsRepo = createDisplayModelsRepo(prefixStorage(storage, 'device'))
