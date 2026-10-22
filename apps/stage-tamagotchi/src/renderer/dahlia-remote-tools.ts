// Dahlia: lets Dahlia on the user's other devices (the phone, and Discord for the bot owner) use this PC:
// its MCP tools, such as the read-only file server, and computer use. Tools that change something ask
// here first, and an allowed tool runs again without asking for 10 minutes. This file is Dahlia's (AIRI
// has no such file); scripts/apply_avatar_branding.sh starts it in the main window.

import type { DahliaRemoteTool, DahliaRemoteToolsState } from '@proj-airi/stage-ui/libs/dahlia-remote-tools'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { dahliaRemoteToolName, DahliaRemoteTools } from '@proj-airi/stage-ui/libs/dahlia-remote-tools'
import { DAHLIA_CHAT_PROVIDER_ID } from '@proj-airi/stage-ui/libs/providers/providers/dahlia'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'

import { electronMcpCallTool, electronMcpListTools } from '../shared/eventa'
import { dahliaGamePlayer, startDahliaGame } from './dahlia-game-player'
import { COMPUTER_USE_TOOL_NAME, computerUseTools } from './stores/tools/builtin/computer-use'
import { resolveInitialRendererRoutePath } from './window-context'

/** Whether this PC's tools are offered ("false" turns it off; on by default). */
export const DAHLIA_REMOTE_TOOLS_ENABLED_KEY = 'dahlia/remote-tools-enabled'
/** The name the other devices see, such as "Desk PC". */
export const DAHLIA_DEVICE_NAME_KEY = 'dahlia/device-name'
/** The connection state, for the Dahlia settings page in the other windows. */
export const DAHLIA_REMOTE_TOOLS_STATUS_KEY = 'dahlia/remote-tools-status'
const DAHLIA_DEVICE_ID_KEY = 'dahlia/device-id'

/** The read-only file server (resources/dahlia-files-mcp.mjs) needs no confirmation. */
const READ_ONLY_SERVERS = new Set(['dahlia-files'])

let started = false

function isMainWindow() {
  return resolveInitialRendererRoutePath('/') === '/'
}

function deviceId() {
  let id = localStorage.getItem(DAHLIA_DEVICE_ID_KEY)
  if (!id) {
    id = `pc-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    localStorage.setItem(DAHLIA_DEVICE_ID_KEY, id)
  }
  return id
}

function text(content: Array<Record<string, unknown>> | undefined) {
  return (content ?? []).map(part => typeof part.text === 'string' ? part.text : JSON.stringify(part)).join('\n')
}

async function listTools(): Promise<DahliaRemoteTool[]> {
  const listMcpTools = useElectronEventaInvoke(electronMcpListTools)
  const callMcpTool = useElectronEventaInvoke(electronMcpCallTool)
  const tools: DahliaRemoteTool[] = []

  for (const descriptor of await listMcpTools().catch(() => [])) {
    tools.push({
      name: dahliaRemoteToolName(`${descriptor.serverName}_${descriptor.toolName}`),
      description: descriptor.description ?? descriptor.toolName,
      inputSchema: descriptor.inputSchema,
      readOnly: READ_ONLY_SERVERS.has(descriptor.serverName),
      run: async (args) => {
        const result = await callMcpTool({ name: descriptor.name, arguments: args })
        const output = text(result.content) || JSON.stringify(result.structuredContent ?? result.toolResult ?? '')
        if (result.isError)
          throw new Error(output)
        return output
      },
    })
  }

  // Screenshots can't travel as text, so only the command tool goes; it runs apps, keys and the mouse.
  const computerUse = (await computerUseTools().catch(() => [])).find(tool => tool.function.name === COMPUTER_USE_TOOL_NAME)
  if (computerUse) {
    tools.push({
      name: COMPUTER_USE_TOOL_NAME,
      description: `${computerUse.function.description} Screenshots stay on the PC: they can't be viewed from here.`,
      inputSchema: computerUse.function.parameters as Record<string, unknown>,
      readOnly: false,
      run: async (args) => {
        const output = await computerUse.execute(args, { messages: [], toolCallId: 'dahlia-remote' })
        return typeof output === 'string' ? output : JSON.stringify(output)
      },
    })
  }

  // Her game. She plays only the game window, so starting and stopping ask nothing here.
  const game = dahliaGamePlayer()
  if (game) {
    const status = () => {
      const state = game.state
      const lines = [state.running ? `Playing (${state.steps} moves so far).` : `Not playing.${state.ended ? ` Last session: ${state.ended}` : ''}`]
      if (state.goal)
        lines.push(`Goal: ${state.goal}`)
      if (state.log.length)
        lines.push('Latest moves:', ...state.log.slice(-6))
      return lines.join('\n')
    }
    tools.push(
      {
        name: 'game_play',
        description: 'Start playing Dark War: Survival on this PC by yourself, or give the running session a new goal or time. Its portrait window must be open on the PC. You make one move every few seconds, keep notes about the game for next time, and stop when the time is up or nothing is left to do.',
        inputSchema: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'What to do in the game, such as "collect rewards and upgrade the headquarters" (optional)' },
            minutes: { type: 'number', description: 'How long to play, 1 to 240 minutes (default 30)' },
          },
        },
        readOnly: true,
        run: async (args) => {
          startDahliaGame({ goal: typeof args.goal === 'string' ? args.goal : undefined, minutes: typeof args.minutes === 'number' ? args.minutes : undefined })
          return `Started. ${status()}`
        },
      },
      {
        name: 'game_stop',
        description: 'Stop playing Dark War: Survival on this PC.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: async () => {
          game.stop('Stopped when asked.')
          return status()
        },
      },
      {
        name: 'game_status',
        description: 'Whether you are playing Dark War: Survival on this PC, and your latest moves.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: async () => status(),
      },
    )
  }

  return tools
}

function confirmCall(tool: DahliaRemoteTool, args: Record<string, unknown>) {
  const details = JSON.stringify(args, null, 2)
  // A native dialog of this window: the call waits for the user here, whatever the app shows.
  // eslint-disable-next-line no-alert
  return Promise.resolve(window.confirm(
    `Dahlia wants to use "${tool.name}" on this PC, for a request from another device:\n\n`
    + `${details.length > 600 ? `${details.slice(0, 600)}…` : details}\n\n`
    + 'Allow it? It then runs without asking for 10 minutes.',
  ))
}

/** Starts offering this PC's tools, in the main window only (every window runs this code). */
export function startDahliaRemoteTools() {
  if (started || !isMainWindow())
    return
  started = true

  const providerConfig = useProviderConfigStore()
  const remote = new DahliaRemoteTools({
    serverUrl: SERVER_URL,
    getKey: () => {
      const apiKey = providerConfig.getProviderConfig(DAHLIA_CHAT_PROVIDER_ID)?.apiKey
      return typeof apiKey === 'string' && apiKey ? apiKey : undefined
    },
    deviceId: deviceId(),
    deviceName: () => localStorage.getItem(DAHLIA_DEVICE_NAME_KEY)?.trim() || 'Windows PC',
    platform: 'Windows',
    enabled: () => localStorage.getItem(DAHLIA_REMOTE_TOOLS_ENABLED_KEY) !== 'false',
    listTools,
    confirm: confirmCall,
    onState: (state: DahliaRemoteToolsState, toolCount: number) => {
      const value = JSON.stringify({ state, tools: toolCount })
      if (localStorage.getItem(DAHLIA_REMOTE_TOOLS_STATUS_KEY) !== value)
        localStorage.setItem(DAHLIA_REMOTE_TOOLS_STATUS_KEY, value)
    },
  })
  remote.start()
}
