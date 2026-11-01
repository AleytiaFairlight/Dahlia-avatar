// Dahlia: the recipes' records as they are stored, tombstones included, for libs/dahlia-recipes-sync.ts. It opens
// the same IndexedDB store as recipes.repo.ts and takes the same lock, so its writes fit between that repo's. This
// file is Dahlia's (AIRI has no such file).

import type { RecipeRecords, RecipeSyncRecord } from '../../libs/dahlia-recipes-sync'

import localforage from 'localforage'

const records = localforage.createInstance({ name: 'airi-recipes', storeName: 'recipes' })

export const dahliaRecipeRecords: RecipeRecords = {
  async all() {
    const stored: RecipeSyncRecord[] = []
    await records.iterate<RecipeSyncRecord, void>((record) => {
      stored.push(record)
    })
    return stored
  },
  async putNewer(incoming) {
    await navigator.locks.request('airi:recipes', async () => {
      for (const record of incoming) {
        const stored = await records.getItem<RecipeSyncRecord>(record.id)
        if (!stored || stored.updatedAt < record.updatedAt)
          await records.setItem<RecipeSyncRecord>(record.id, record)
      }
    })
  },
}
