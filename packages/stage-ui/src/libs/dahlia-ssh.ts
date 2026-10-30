// Dahlia: Settings > Dahlia > SSH reaches the desktop app's SSH (src/main/dahlia-ssh.ts) through what the app
// registers here: this PC's key, the saved passwords (which go in and never come back out) and the trusted host
// keys. Other apps register nothing, and the settings hide the section. This file is Dahlia's (AIRI has no such file).

export interface DahliaSshSettings {
  publicKey?: string
  keyFile: string
  /** Logins with a saved password, as user@host:port. */
  passwords: string[]
  hosts: { host: string, fingerprint: string }[]
  canSavePasswords: boolean
}

export type DahliaSshSettingsRequest
  = | { op: 'list' }
    | { op: 'create-key' }
    | { op: 'save-password', host: string, user: string, port?: number, password: string }
    | { op: 'delete-password', target: string }
    | { op: 'forget-host', host: string }

let handler: ((request: DahliaSshSettingsRequest) => Promise<DahliaSshSettings>) | undefined

/** The desktop app tells how to reach its SSH settings. */
export function registerDahliaSsh(settings: (request: DahliaSshSettingsRequest) => Promise<DahliaSshSettings>) {
  handler = settings
}

/** Whether this app has SSH (the desktop app). */
export function hasDahliaSsh(): boolean {
  return handler !== undefined
}

/** Asks the desktop app; it throws with a message to show when a request fails. */
export async function dahliaSshSettings(request: DahliaSshSettingsRequest): Promise<DahliaSshSettings> {
  if (!handler)
    throw new Error('SSH runs only in the desktop app.')
  return await handler(request)
}
