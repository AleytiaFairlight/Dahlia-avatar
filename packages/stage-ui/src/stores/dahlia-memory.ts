// Dahlia: her memory lives on her server (DahliaBot's DahliaMemoryStore), the same for Discord, Twitch and both
// apps. Settings > Long-Term Memory shows and changes it through this store: the switch, which every device and her
// server share (Discord and Twitch follow it too), and her memories. AIRI's own memory, kept on each device, stays
// off: runs get hers from the server instead, and what AIRI kept on a device moves to the server once. This file is
// Dahlia's (AIRI has no such file); stores/dahlia-settings-sync.ts calls it when the apps start.

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { memoryRepo } from '../database/repos/memory.repo'
import { SERVER_URL } from '../libs/server'
import { dahliaHeaders, dahliaSession, useDahliaAuth } from './dahlia-auth'
import { useMemoryStore } from './memory'

/** Set once the apps' own memory was turned off, so turning it on again in the settings stays. */
export const DAHLIA_SERVER_MEMORY_KEY = 'dahlia/server-memory'

/**
 * "Use long-term memory": a shared setting (libs/dahlia-settings-sync.ts) that her server reads too
 * (MemorySwitch.SETTING). Off, she neither reads, saves nor summarizes this person's memories anywhere.
 */
export const DAHLIA_MEMORY_ENABLED_KEY = 'dahlia/memory-enabled'

/** Runs never get AIRI's memory prompt or tools: the server gives her hers (stores/chat.ts reads this). */
export const DAHLIA_SERVER_MEMORY = true

/** The owner's notes on her game, which the owner's memory page shows too. */
export const DARK_WAR_SUBJECT = 'game:dark-war-survival'

const MEMORIES_PATH = '/api/v1/dahlia/memories'

/** One of her memories, as her server lists it. */
export interface DahliaMemory {
  id: number
  kind: string
  text: string
  source?: string
  updatedAt: string
  subject: string
}

export function useDahliaServerMemoryOnce() {
  if (localStorage.getItem(DAHLIA_SERVER_MEMORY_KEY))
    return
  useMemoryStore().enabled = false
  localStorage.setItem(DAHLIA_SERVER_MEMORY_KEY, 'true')
}

async function memoryRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SERVER_URL}${MEMORIES_PATH}${path}`, {
    ...init,
    headers: dahliaHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(response.status === 401
      ? 'Dahlia\'s server didn\'t accept the key.'
      : response.status === 403 ? 'Pass the voice check to see her memories.' : `Dahlia's server answered ${response.status}.`)
  }
  return response
}

/** What a memory AIRI kept says, as one text: its index line only when the fact doesn't already say it. */
export function deviceMemoryText(entry: { description: string, body: string }) {
  const description = entry.description.trim()
  const body = entry.body.trim()
  return !description || body.toLowerCase().includes(description.toLowerCase()) ? body : `${description}: ${body}`
}

/**
 * Moves the memories AIRI kept on this device to her server: each one is removed here once the server has it, so
 * none is lost or sent twice. Needs the voice-checked session. Resolves to how many moved.
 */
export async function moveDeviceMemories() {
  if (!dahliaSession())
    return 0
  let moved = 0
  for (const entry of await memoryRepo.list()) {
    const text = deviceMemoryText(entry)
    // Kept here until the server has it: a request that fails throws before the removal.
    if (text && !(await memoryRequest('', { method: 'POST', body: JSON.stringify({ text }) })).ok)
      throw new Error('Dahlia\'s server didn\'t save a memory from this device.')
    await memoryRepo.remove([entry.id], Date.now())
    moved++
  }
  return moved
}

/**
 * Her memories for Settings > Long-Term Memory: the switch, the list (the owner's memories and her game notes, or
 * someone else's own), and adding and forgetting one.
 */
export const useDahliaMemoryStore = defineStore('dahlia-memory', () => {
  const auth = useDahliaAuth()
  const enabled = useLocalStorage<boolean>(DAHLIA_MEMORY_ENABLED_KEY, true)
  const memories = ref<DahliaMemory[]>([])
  const error = ref<string>()
  const loading = ref(false)

  const groups = computed(() => [
    { key: 'fact', title: 'About you', icon: 'i-solar:user-rounded-bold-duotone', items: memories.value.filter(m => m.kind === 'fact') },
    { key: 'conversation', title: 'Conversations', icon: 'i-solar:chat-round-dots-bold-duotone', items: memories.value.filter(m => m.kind === 'conversation') },
    { key: 'game', title: 'Dark War: Survival', icon: 'i-solar:gamepad-bold-duotone', items: memories.value.filter(m => m.kind === 'game') },
  ])

  async function load() {
    if (!auth.session.value)
      return
    loading.value = true
    error.value = undefined
    try {
      await moveDeviceMemories().catch(moveError => console.warn('Dahlia: could not move this device\'s memories to her server', moveError))
      // The owner's game notes are hers; everyone else has their own memories only.
      const subjects = auth.me.value?.owner ? ['owner', DARK_WAR_SUBJECT] : ['owner']
      const lists = await Promise.all(subjects.map(async (subject) => {
        const { memories: list } = await (await memoryRequest(`?subject=${encodeURIComponent(subject)}`)).json() as { memories: Omit<DahliaMemory, 'subject'>[] }
        return list.map(memory => ({ ...memory, subject }))
      }))
      memories.value = lists.flat()
    }
    catch (loadError) {
      error.value = errorMessageFrom(loadError) ?? 'Her memories couldn\'t be loaded.'
    }
    finally {
      loading.value = false
    }
  }

  async function add(text: string) {
    if (!text.trim())
      return
    await memoryRequest('', { method: 'POST', body: JSON.stringify({ text: text.trim() }) }).catch(() => undefined)
    await load()
  }

  async function forget(memory: DahliaMemory) {
    await memoryRequest(`/${memory.id}?subject=${encodeURIComponent(memory.subject)}`, { method: 'DELETE' }).catch(() => undefined)
    await load()
  }

  return {
    enabled,
    memories: computed(() => memories.value),
    groups,
    error: computed(() => error.value),
    loading: computed(() => loading.value),
    load,
    add,
    forget,
  }
})
