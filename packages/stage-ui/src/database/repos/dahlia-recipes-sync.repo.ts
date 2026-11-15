// Dahlia: the recipes' records as they are stored, tombstones included, for libs/dahlia-recipes-sync.ts. It uses
// the same store as recipes.repo.ts (raw records) and takes the same lock, so its writes fit between that repo's. This
// file is Dahlia's (AIRI has no such file).

import type { RecipeRecords, RecipeSyncRecord } from '../../libs/dahlia-recipes-sync'

import { prefixStorage } from 'unstorage'

import { listRawItems, storage } from '../storage'

const records = prefixStorage(storage, 'recipes')

export const dahliaRecipeRecords: RecipeRecords = {
  async all() {
    return (await listRawItems<RecipeSyncRecord>(records, '')).map(([, record]) => record)
  },
  async putNewer(incoming) {
    await navigator.locks.request('airi:recipes', async () => {
      for (const record of incoming) {
        const stored = await records.getItemRaw<RecipeSyncRecord>(record.id)
        if (!stored || stored.updatedAt < record.updatedAt)
          await records.setItemRaw<RecipeSyncRecord>(record.id, record)
      }
    })
  },
}
