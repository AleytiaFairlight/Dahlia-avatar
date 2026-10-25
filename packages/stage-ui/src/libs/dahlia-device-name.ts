// Dahlia: the name Dahlia's other devices see for this one: the name set in Settings > Dahlia, or else the
// system's own name (the PC's host name on Windows, the phone's device name on Android), which each app
// registers. This file is Dahlia's (AIRI has no such file).

/** The name set in Settings > Dahlia; empty means the system's name. */
export const DAHLIA_DEVICE_NAME_KEY = 'dahlia/device-name'

/** Earlier apps saved this default on every device, the phone too: it counts as no name. */
const OLD_DEFAULTS = new Set(['Windows PC'])

let systemName: (() => Promise<string | undefined>) | undefined

/** The app tells how to read the system's name. */
export function registerDahliaSystemName(read: () => Promise<string | undefined>) {
  systemName = read
}

/** The system's name, or undefined when the app can't tell. */
export async function dahliaSystemName(): Promise<string | undefined> {
  try {
    const name = (await systemName?.())?.trim()
    return name || undefined
  }
  catch {
    return undefined
  }
}

/** The name set in Settings > Dahlia, if any. */
export function chosenDahliaDeviceName(storage: Pick<Storage, 'getItem'> = localStorage): string | undefined {
  const name = storage.getItem(DAHLIA_DEVICE_NAME_KEY)?.trim()
  return name && !OLD_DEFAULTS.has(name) ? name : undefined
}

/** The name of this device for the others: the chosen one, the system's, or the fallback. */
export function dahliaDeviceName(system: string | undefined, fallback: string, storage: Pick<Storage, 'getItem'> = localStorage): string {
  return chosenDahliaDeviceName(storage) ?? system ?? fallback
}
