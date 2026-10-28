// Dahlia: which program the game_launch tool of dahlia-remote-tools.ts starts. This file is Dahlia's (AIRI has no
// such file).

export interface GameStartDeps {
  /** The path she gave: a program, a shortcut, or the game's folder. */
  given?: string
  /** The program that started this game last time. */
  remembered?: string
  /** The best match for the game inside a folder; rejects or gives undefined when it isn't a folder. */
  searchIn: (folder: string) => Promise<string | undefined>
  /** The best match for the game in the usual places. */
  search: () => Promise<string | undefined>
  launch: (path: string) => Promise<{ ok: boolean, error?: string }>
}

export interface GameStart {
  /** The program that started, or undefined. */
  file?: string
  /** How many programs were tried. */
  tried: number
  /** Why the last one didn't start. */
  lastError?: string
}

/**
 * Starts the game, taking her path as a hint rather than the only try. She once passed the game's folder, which can't
 * be started, and the tool gave up instead of looking. In order: her path, the program that started the game last
 * time, the game inside her path when it is a folder, and the best match of the usual places. Each is tried once.
 */
export async function startGameProgram(deps: GameStartDeps): Promise<GameStart> {
  const tried = new Set<string>()
  let lastError: string | undefined

  async function start(candidate: string | undefined) {
    if (!candidate || tried.has(candidate))
      return undefined
    tried.add(candidate)
    const launched = await deps.launch(candidate)
    if (launched.ok)
      return candidate
    lastError = launched.error
    return undefined
  }

  let file = await start(deps.given) ?? await start(deps.remembered)
  if (!file && deps.given)
    file = await start(await deps.searchIn(deps.given).catch(() => undefined))
  if (!file)
    file = await start(await deps.search().catch(() => undefined))
  return { file, tried: tried.size, lastError }
}
