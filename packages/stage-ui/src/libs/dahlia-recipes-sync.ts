// Dahlia: keeps the recipes of Settings > Long-Term Memory the same on every device. Dahlia's server stores each
// person's recipes (/api/v1/dahlia/recipes, with the voice-checked session); each app sends its records and takes
// the newer ones. AIRI keeps a removed recipe as a dated tombstone for this, so a removal reaches the other devices.
// This file is Dahlia's (AIRI has no such file); stores/dahlia-settings-sync.ts starts it.

/** The recipes API on Dahlia's server. */
export const RECIPES_SYNC_PATH = '/api/v1/dahlia/recipes'

/** A stored recipe record (database/repos/recipes.repo.ts) or the tombstone of a removed one. */
export interface RecipeSyncRecord {
  id: string
  updatedAt: number
  deleted?: true
  [field: string]: unknown
}

/** The recipes on this device, tombstones included. */
export interface RecipeRecords {
  all: () => Promise<RecipeSyncRecord[]>
  /** Stores each record that is newer than the one stored with its id. */
  putNewer: (records: RecipeSyncRecord[]) => Promise<void>
}

export interface RecipesSyncOptions {
  serverUrl: string
  /** The voice-checked session, or undefined before there is one. */
  getKey: () => string | undefined
  records: RecipeRecords
  fetcher?: typeof fetch
  /** Called with the ids that changed here, so the recipes store reads them again. */
  onChanged?: (ids: string[]) => void
}

/** Two-way sync of the recipes: for each recipe the newest change wins, a removal included. */
export class DahliaRecipesSync {
  private readonly fetcher: typeof fetch
  private running: Promise<number> | undefined
  private pending = false

  constructor(private readonly options: RecipesSyncOptions) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  }

  /** Exchanges the recipes with the server; resolves to how many changed here. Calls during a run add one more run. */
  async sync(): Promise<number> {
    if (this.running) {
      this.pending = true
      return this.running
    }
    this.running = this.syncInternal().finally(() => {
      this.running = undefined
      if (this.pending) {
        this.pending = false
        void this.sync()
      }
    })
    return this.running
  }

  private async syncInternal() {
    const key = this.options.getKey()
    if (!key)
      return 0

    const local = await this.options.records.all()
    const response = await this.fetcher(new URL(RECIPES_SYNC_PATH, this.options.serverUrl).href, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: local }),
    })
    if (!response.ok)
      return 0

    const known = new Map(local.map(record => [record.id, record.updatedAt]))
    const remote = ((await response.json()) as { records?: RecipeSyncRecord[] }).records ?? []
    const newer = remote.filter(record => typeof record.id === 'string' && record.updatedAt > (known.get(record.id) ?? 0))
    if (newer.length === 0)
      return 0
    await this.options.records.putNewer(newer)
    this.options.onChanged?.(newer.map(record => record.id))
    return newer.length
  }
}
