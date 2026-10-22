// Dahlia: her memory lives on her server (DahliaBot's DahliaMemoryStore), the same for Discord and both apps,
// so the apps' own memory, kept per device, is turned off once. This file is Dahlia's (AIRI has no such
// file); stores/dahlia-settings-sync.ts calls it when the apps start.

import { useMemoryStore } from './memory'

/** Set once the apps' own memory was turned off, so turning it on again in the settings stays. */
export const DAHLIA_SERVER_MEMORY_KEY = 'dahlia/server-memory'

export function useDahliaServerMemoryOnce() {
  if (localStorage.getItem(DAHLIA_SERVER_MEMORY_KEY))
    return
  useMemoryStore().enabled = false
  localStorage.setItem(DAHLIA_SERVER_MEMORY_KEY, 'true')
}
