// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { syncCategories, useSyncPreferencesStore } from './sync-preferences'

describe('sync preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('turns every sync on by default', () => {
    const store = useSyncPreferencesStore()

    for (const category of syncCategories)
      expect(store.isEnabled(category)).toBe(true)
  })

  // Storage takes the change after the current tick.
  it('saves a switch on the device', async () => {
    useSyncPreferencesStore().setEnabled('chats', false)
    await nextTick()

    expect(JSON.parse(localStorage.getItem('settings/sync') ?? '{}')).toEqual({ chats: false })
  })

  it('keeps a switch that an earlier version saved', () => {
    localStorage.setItem('settings/sync', JSON.stringify({ chats: false }))

    expect(useSyncPreferencesStore().isEnabled('chats')).toBe(false)
  })
})
