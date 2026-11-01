// Dahlia: tests for dahlia-recipes-sync.ts: the recipes of Settings > Long-Term Memory are the same on every device.
import type { RecipeSyncRecord } from './dahlia-recipes-sync'

import { describe, expect, it } from 'vitest'

import { DahliaRecipesSync, RECIPES_SYNC_PATH } from './dahlia-recipes-sync'

function recipe(id: string, updatedAt: number, name = id): RecipeSyncRecord {
  return { id, updatedAt, order: 1, createdAt: 1, recipe: { id, name, approved: true } }
}

/** A device's records and a server that keeps each record's newest change, as Dahlia's server does. */
function setup(local: RecipeSyncRecord[], server: RecipeSyncRecord[], key: string | null = 'session') {
  const stored = new Map(local.map(record => [record.id, record]))
  const remote = new Map(server.map(record => [record.id, record]))
  const requests: { url: string, auth: string, sent: RecipeSyncRecord[] }[] = []
  const changed: string[][] = []
  const sync = new DahliaRecipesSync({
    serverUrl: 'https://dahlia.example',
    getKey: () => key ?? undefined,
    records: {
      all: async () => [...stored.values()],
      putNewer: async (records) => {
        for (const record of records) {
          if ((stored.get(record.id)?.updatedAt ?? 0) < record.updatedAt)
            stored.set(record.id, record)
        }
      },
    },
    fetcher: async (input, init) => {
      const sent = (JSON.parse(String(init?.body)) as { records: RecipeSyncRecord[] }).records
      requests.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') ?? '', sent })
      for (const record of sent) {
        if ((remote.get(record.id)?.updatedAt ?? 0) < record.updatedAt)
          remote.set(record.id, record)
      }
      return new Response(JSON.stringify({ records: [...remote.values()] }), { status: 200 })
    },
    onChanged: ids => changed.push(ids),
  })
  return { sync, stored, remote, requests, changed }
}

describe('dahlia recipes sync', () => {
  it('sends this device\'s recipes and takes the newer ones, a removal included', async () => {
    const { sync, stored, remote, requests, changed } = setup(
      [recipe('mine', 10), recipe('edited', 5, 'old'), recipe('gone', 5)],
      [recipe('theirs', 7), recipe('edited', 9, 'new'), { id: 'gone', updatedAt: 8, deleted: true }],
    )

    expect(await sync.sync()).toBe(3)

    expect(requests[0].url).toBe(`https://dahlia.example${RECIPES_SYNC_PATH}`)
    expect(requests[0].auth).toBe('Bearer session')
    expect(remote.get('mine')?.updatedAt).toBe(10)
    expect((stored.get('edited')?.recipe as { name: string }).name).toBe('new')
    expect(stored.get('gone')?.deleted).toBe(true)
    expect(stored.has('theirs')).toBe(true)
    expect(changed).toEqual([['theirs', 'edited', 'gone']])
  })

  it('keeps a newer change made here', async () => {
    const { sync, stored, remote, changed } = setup([recipe('r', 20, 'here')], [recipe('r', 10, 'there')])

    expect(await sync.sync()).toBe(0)
    expect((stored.get('r')?.recipe as { name: string }).name).toBe('here')
    expect((remote.get('r')?.recipe as { name: string }).name).toBe('here')
    expect(changed).toEqual([])
  })

  it('does nothing before the voice check', async () => {
    const { sync, requests } = setup([recipe('r', 1)], [], null)

    expect(await sync.sync()).toBe(0)
    expect(requests).toEqual([])
  })
})
