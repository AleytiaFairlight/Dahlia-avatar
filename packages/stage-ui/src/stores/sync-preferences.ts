import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { boolean, parse, record, string } from 'valibot'

/**
 * The kinds of data that sync to Dahlia's server. Each kind has its own switch.
 *
 * - `chats`: the text of chat messages and the chat titles.
 */
export const syncCategories = ['chats'] as const

export type SyncCategory = typeof syncCategories[number]

const preferencesSchema = record(string(), boolean())

/**
 * The sync switches of this device. Each sync is on by default, and the apps have no page that turns one off.
 *
 * The choices stay on the device. Each window reads them from local storage.
 * A change in one window reaches the other windows through the storage event.
 */
export const useSyncPreferencesStore = defineStore('sync-preferences', () => {
  /** Only a switch that was changed has an entry. */
  const preferences = useLocalStorage<Record<string, boolean>>('settings/sync', {}, {
    serializer: {
      read: (value: string) => parse(preferencesSchema, JSON.parse(value)),
      write: (value: Record<string, boolean>) => JSON.stringify(value),
    },
  })

  function isEnabled(category: SyncCategory): boolean {
    return preferences.value[category] ?? true
  }

  function setEnabled(category: SyncCategory, enabled: boolean) {
    if (preferences.value[category] === enabled)
      return
    preferences.value = { ...preferences.value, [category]: enabled }
  }

  return {
    isEnabled,
    setEnabled,
  }
})
