import type { DahliaMemoryMap } from './dahlia-memory-map'

import { describe, expect, it, vi } from 'vitest'

import { buildDahliaMapGraph, dahliaMemoryTimeline, entitiesOf, memoriesOf } from './dahlia-memory-map'

vi.mock('../stores/dahlia-auth', () => ({ dahliaHeaders: () => ({}) }))

const map: DahliaMemoryMap = {
  entities: [
    { id: 1, name: 'Mira', kind: 'person', aliases: ['sister'] },
    { id: 2, name: 'Lisbon', kind: 'place', aliases: [] },
    { id: 3, name: 'Miso', kind: 'pet', aliases: [] },
  ],
  memories: [
    { id: 10, kind: 'fact', text: 'Mira lives in Lisbon.', createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z' },
    { id: 11, kind: 'fact', text: 'Mira paints.', createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z' },
    { id: 12, kind: 'fact', text: 'Purple is her colour.', createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z' },
  ],
  links: [{ memory: 10, entity: 1 }, { memory: 10, entity: 2 }, { memory: 11, entity: 1 }, { memory: 99, entity: 1 }],
}

describe('dahlia memory map', () => {
  it('puts the entities that memories name on the map, each memory linked to them', () => {
    const graph = buildDahliaMapGraph(map)

    expect(graph.nodes.map(node => node.id).sort()).toEqual(['e1', 'e2', 'm10', 'm11'])
    expect(graph.nodes.find(node => node.id === 'e1')?.degree).toBe(2)
    expect(graph.links).toEqual([{ source: 'e1', target: 'm10' }, { source: 'e2', target: 'm10' }, { source: 'e1', target: 'm11' }])
    expect(graph.unlinked).toBe(1)
  })

  it('finds an entity\'s memories and a memory\'s entities', () => {
    expect(memoriesOf(map, 1).map(memory => memory.id)).toEqual([10, 11])
    expect(entitiesOf(map, 10).map(entity => entity.name)).toEqual(['Mira', 'Lisbon'])
  })

  it('groups the timeline by month, the newest first', () => {
    const months = dahliaMemoryTimeline(map.memories, 'en-US')

    expect(months.map(month => month.key)).toEqual(['2026-11', '2026-10'])
    expect(months[0]!.memories.map(memory => memory.id)).toEqual([11, 12])
    expect(months[0]!.label).toBe('November 2026')
  })
})
