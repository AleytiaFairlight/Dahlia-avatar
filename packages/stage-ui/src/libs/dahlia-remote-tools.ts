// Dahlia: offers a device's tools to Dahlia on the user's other devices, through her server
// (/api/v1/dahlia/devices, with the Dahlia key). The device polls with the tools it offers and runs the
// calls it gets back; Dahlia's chat on the phone, and Discord for the bot owner, reach them there. This
// file is Dahlia's (AIRI has no such file); the desktop app starts it (src/renderer/dahlia-remote-tools.ts).

import { errorMessageFrom } from '@moeru/std'

/** A tool this device offers. Read-only tools run at once; others ask on the device first. */
export interface DahliaRemoteTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
  run: (args: Record<string, unknown>) => Promise<string>
}

export type DahliaRemoteToolsState = 'off' | 'no-key' | 'connecting' | 'connected' | 'bad-key' | 'error'

export interface DahliaRemoteToolsOptions {
  serverUrl: string
  getKey: () => string | undefined
  deviceId: string
  deviceName: () => string
  platform: string
  enabled: () => boolean
  listTools: () => Promise<DahliaRemoteTool[]>
  /** Asks the user on this device whether a call that changes something may run. */
  confirm: (tool: DahliaRemoteTool, args: Record<string, unknown>) => Promise<boolean>
  onState?: (state: DahliaRemoteToolsState, toolCount: number) => void
  fetcher?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** How long an allowed tool runs again without asking. */
export const DAHLIA_REMOTE_APPROVAL_MS = 10 * 60_000
/** How often the list of offered tools is read again. */
const TOOLS_REFRESH_MS = 60_000
const MAX_RESULT_CHARS = 16_000

interface RemoteCall {
  id: string
  tool: string
  arguments?: Record<string, unknown>
}

export class DahliaRemoteTools {
  private tools: DahliaRemoteTool[] = []
  private toolsReadAt = Number.NEGATIVE_INFINITY
  private readonly approvedUntil = new Map<string, number>()
  private running = false
  private failures = 0

  constructor(private readonly options: DahliaRemoteToolsOptions) {}

  private get fetcher() {
    return this.options.fetcher ?? fetch
  }

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  private sleep(ms: number) {
    return this.options.sleep?.(ms) ?? new Promise<void>(resolve => setTimeout(resolve, ms))
  }

  /** Polls until stop(): the server answers a poll when calls come, or after about 25 seconds. */
  start() {
    if (this.running)
      return
    this.running = true
    void (async () => {
      while (this.running) {
        const wait = await this.cycle()
        if (wait > 0)
          await this.sleep(wait)
      }
    })()
  }

  stop() {
    this.running = false
  }

  /** One poll and the calls it brought. Returns how long to wait before the next. */
  async cycle(): Promise<number> {
    const key = this.options.getKey()
    if (!this.options.enabled()) {
      this.options.onState?.('off', 0)
      return 15_000
    }
    if (!key) {
      this.options.onState?.('no-key', 0)
      return 30_000
    }

    try {
      if (this.now() - this.toolsReadAt >= TOOLS_REFRESH_MS) {
        this.tools = await this.options.listTools()
        this.toolsReadAt = this.now()
      }

      const response = await this.fetcher(`${this.options.serverUrl}/api/v1/dahlia/devices/poll`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.options.deviceId,
          name: this.options.deviceName(),
          platform: this.options.platform,
          tools: this.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, readOnly: tool.readOnly })),
        }),
        signal: AbortSignal.timeout(45_000),
      })
      if (response.status === 401) {
        this.options.onState?.('bad-key', this.tools.length)
        return 60_000
      }
      if (!response.ok)
        throw new Error(`Dahlia's server answered ${response.status}`)

      this.failures = 0
      this.options.onState?.('connected', this.tools.length)
      const { calls = [] } = await response.json() as { calls?: RemoteCall[] }
      // Calls run side by side, each result as soon as it is ready; the next poll doesn't wait for them.
      for (const call of calls)
        void this.answer(call, key)
      return 0
    }
    catch (error) {
      this.failures++
      this.options.onState?.('error', this.tools.length)
      console.warn('Dahlia: could not reach her server for remote tools', error)
      return Math.min(60_000, 2_000 * 2 ** Math.min(this.failures, 5))
    }
  }

  /** Runs one call and sends its result. */
  async answer(call: RemoteCall, key: string) {
    const result = await this.run(call)
    try {
      await this.fetcher(`${this.options.serverUrl}/api/v1/dahlia/devices/results`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: this.options.deviceId, results: [{ id: call.id, ...result }] }),
        signal: AbortSignal.timeout(30_000),
      })
    }
    catch (error) {
      console.warn('Dahlia: could not send a remote tool result', error)
    }
  }

  private async run(call: RemoteCall): Promise<{ text: string, isError: boolean }> {
    const tool = this.tools.find(candidate => candidate.name === call.tool)
    if (!tool)
      return { text: `This device has no tool named ${call.tool} any more.`, isError: true }

    const args = call.arguments ?? {}
    if (!tool.readOnly && (this.approvedUntil.get(tool.name) ?? 0) <= this.now()) {
      if (!await this.options.confirm(tool, args))
        return { text: 'The user didn\'t allow this on the device.', isError: true }
      this.approvedUntil.set(tool.name, this.now() + DAHLIA_REMOTE_APPROVAL_MS)
    }

    try {
      const text = await tool.run(args)
      return { text: text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[cut: the result was longer]` : text, isError: false }
    }
    catch (error) {
      return { text: errorMessageFrom(error) ?? 'The tool failed.', isError: true }
    }
  }
}

/** A tool name the server accepts: letters, digits, _ and -, at most 64 characters. */
export function dahliaRemoteToolName(name: string) {
  return name.replace(/[^\w-]/g, '_').slice(0, 64)
}
