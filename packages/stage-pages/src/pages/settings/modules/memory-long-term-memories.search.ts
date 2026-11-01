// Dahlia: searches her memories on her server (stores/dahlia-memory.ts), which the memories page lists, instead of
// AIRI's memories on the device.
import type { SettingsSearchModule } from '@proj-airi/stage-ui/libs/settings-search'
import type { DahliaMemory } from '@proj-airi/stage-ui/stores/dahlia-memory'

import { settingsSearchItemKey } from '@proj-airi/stage-shared/settings-search'
import { useDahliaMemoryStore } from '@proj-airi/stage-ui/stores/dahlia-memory'

/** The marker of a memory's row: her memories are told apart by whose they are and their number. */
export function memorySearchKey(entry: Pick<DahliaMemory, 'id' | 'subject'>) {
  return settingsSearchItemKey('memory', entry.subject, String(entry.id))
}

/** The memories page, with each memory under its group, as the page shows them. They load from her server first. */
export default {
  routes: [{
    path: '/settings/modules/memory-long-term-memories',
    items: async () => {
      const memory = useDahliaMemoryStore()
      await memory.load()
      return memory.groups.flatMap(group => group.items.map(entry => ({
        title: entry.text,
        key: memorySearchKey(entry),
        section: group.title,
      })))
    },
  }],
} satisfies SettingsSearchModule
