// Dahlia: her memories as a map and a timeline (components/modules/DahliaMemoryExplorer.vue). Her server gives her
// memories, the people and things of her ledger and which memories name which (GET /api/v1/dahlia/memories/map, a
// voice-checked session); this file turns them into the map's nodes and links and the timeline's months. After the
// memory explorer of dasilva333/airi (a mind map of memories and entities with a timeline); the code is Dahlia's.
// This file is Dahlia's (AIRI has no such file).

import { dahliaHeaders } from '../stores/dahlia-auth'
import { SERVER_URL } from './server'

export interface DahliaMapEntity { id: number, name: string, kind: string, aliases: string[] }
export interface DahliaMapMemory { id: number, kind: string, text: string, createdAt: string, updatedAt: string }
export interface DahliaMemoryMap {
  entities: DahliaMapEntity[]
  memories: DahliaMapMemory[]
  links: Array<{ memory: number, entity: number }>
}

export type DahliaMapNode
  = | { id: string, type: 'entity', entity: DahliaMapEntity, degree: number }
    | { id: string, type: 'memory', memory: DahliaMapMemory, degree: number }

export interface DahliaMapGraph {
  nodes: DahliaMapNode[]
  links: Array<{ source: string, target: string }>
  /** Memories that name no one in her ledger: they are in the timeline, not on the map. */
  unlinked: number
}

/** Colors of the kinds of entities and memories, readable on light and dark. */
export const MAP_COLORS: Record<string, string> = {
  'person': '#ec4899',
  'pet': '#f59e0b',
  'place': '#10b981',
  'work': '#8b5cf6',
  'organization': '#3b82f6',
  'thing': '#64748b',
  'fact': '#94a3b8',
  'conversation': '#38bdf8',
  'dream': '#c084fc',
  '': '#a3a3a3',
}

export async function fetchDahliaMemoryMap(signal?: AbortSignal, serverUrl = SERVER_URL, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<DahliaMemoryMap> {
  const response = await fetcher(`${serverUrl}/api/v1/dahlia/memories/map`, { headers: dahliaHeaders(), signal })
  if (!response.ok) {
    throw new Error(response.status === 403
      ? 'Pass the voice check to see her memories.'
      : `Dahlia's server answered ${response.status}.`)
  }
  const map = await response.json() as Partial<DahliaMemoryMap>
  return { entities: map.entities ?? [], memories: map.memories ?? [], links: map.links ?? [] }
}

/** The map: every entity a memory names, and those memories, each linked to the entities it names. */
export function buildDahliaMapGraph(map: DahliaMemoryMap): DahliaMapGraph {
  const entities = new Map(map.entities.map(entity => [entity.id, entity]))
  const memories = new Map(map.memories.map(memory => [memory.id, memory]))
  const links = map.links.filter(link => entities.has(link.entity) && memories.has(link.memory))
  const degree = new Map<string, number>()
  for (const link of links) {
    degree.set(`e${link.entity}`, (degree.get(`e${link.entity}`) ?? 0) + 1)
    degree.set(`m${link.memory}`, (degree.get(`m${link.memory}`) ?? 0) + 1)
  }

  const nodes: DahliaMapNode[] = [
    ...map.entities.filter(entity => degree.has(`e${entity.id}`)).map(entity => ({ id: `e${entity.id}`, type: 'entity' as const, entity, degree: degree.get(`e${entity.id}`)! })),
    ...map.memories.filter(memory => degree.has(`m${memory.id}`)).map(memory => ({ id: `m${memory.id}`, type: 'memory' as const, memory, degree: degree.get(`m${memory.id}`)! })),
  ]
  return {
    nodes,
    links: links.map(link => ({ source: `e${link.entity}`, target: `m${link.memory}` })),
    unlinked: map.memories.length - map.memories.filter(memory => degree.has(`m${memory.id}`)).length,
  }
}

/** The memories that name an entity, by its id. */
export function memoriesOf(map: DahliaMemoryMap, entityId: number) {
  const ids = new Set(map.links.filter(link => link.entity === entityId).map(link => link.memory))
  return map.memories.filter(memory => ids.has(memory.id))
}

/** The entities a memory names. */
export function entitiesOf(map: DahliaMemoryMap, memoryId: number) {
  const ids = new Set(map.links.filter(link => link.memory === memoryId).map(link => link.entity))
  return map.entities.filter(entity => ids.has(entity.id))
}

/** The timeline: memories by the month they were made, the newest month and memory first. */
export function dahliaMemoryTimeline(memories: DahliaMapMemory[], locale?: string) {
  const months = new Map<string, { key: string, label: string, memories: DahliaMapMemory[] }>()
  const sorted = [...memories].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  for (const memory of sorted) {
    const date = new Date(memory.createdAt)
    if (Number.isNaN(date.getTime()))
      continue
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (!months.has(key))
      months.set(key, { key, label: date.toLocaleDateString(locale, { year: 'numeric', month: 'long' }), memories: [] })
    months.get(key)!.memories.push(memory)
  }
  return [...months.values()]
}
