// Dahlia: lets Dahlia on the user's other devices (the phone, and Discord for the bot owner) use this PC:
// its MCP tools, such as the read-only file server, PowerShell and computer use, screenshots and recordings,
// and finding, starting and playing games. Tools that change
// something ask here first, and an allowed tool runs again without asking for 10 minutes (PowerShell and SSH
// ask for every command), unless the user lets them run without asking. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh starts it in the main window.

import type { DahliaErrorSourceResult } from '@proj-airi/stage-ui/libs/dahlia-error-reports'
import type { DahliaRemoteTool, DahliaRemoteToolsState } from '@proj-airi/stage-ui/libs/dahlia-remote-tools'
import type { DahliaSshSettings } from '@proj-airi/stage-ui/libs/dahlia-ssh'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { findDahliaAnimation, listDahliaAnimations, sendDahliaAnimationCommand } from '@proj-airi/stage-ui-three/dahlia-animations'
import { dahliaAssistantReaction, dahliaAssistantReactionsEnabled } from '@proj-airi/stage-ui/libs/dahlia-assistant-reactions'
import { dahliaDeviceName, dahliaSystemName, registerDahliaSystemName } from '@proj-airi/stage-ui/libs/dahlia-device-name'
import { registerDahliaErrorSource } from '@proj-airi/stage-ui/libs/dahlia-error-reports'
import { parseScreenWords, screenChanged } from '@proj-airi/stage-ui/libs/dahlia-game-player'
import { dahliaRemoteToolName, DahliaRemoteTools } from '@proj-airi/stage-ui/libs/dahlia-remote-tools'
import { registerDahliaSsh } from '@proj-airi/stage-ui/libs/dahlia-ssh'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { useLlmStreamingControlStore } from '@proj-airi/stage-ui/stores/ai/chat-llm/streaming-control'
import { dahliaBearer, dahliaDeviceId } from '@proj-airi/stage-ui/stores/dahlia-auth'
import { registerDahliaWorkflowSignIn } from '@proj-airi/stage-ui/stores/dahlia-workflows'

import { electronMcpCallTool, electronMcpListTools } from '../shared/eventa'
import { dahliaGamePlayer, DARK_WAR_LAUNCHER_TITLE, DARK_WAR_START_BUTTON, DARK_WAR_SURVIVAL, DARK_WAR_SURVIVAL_NAME, DARK_WAR_WINDOW_TITLE, locateInGame, startDahliaGame } from './dahlia-game-player'
import { startGameProgram } from './dahlia-game-start'
import { dahliaGameWatcher, startWatchingDahliaGame } from './dahlia-game-watch'
import { grabDahliaScreenshot, MAX_RECORDING_SECONDS, recordDahliaScreen } from './dahlia-screen-recorder'
import { dahliaScreenInterests, dahliaScreenWatcher, setDahliaScreenInterests, startWatchingDahliaScreen } from './dahlia-screen-watch'
import { resolveInitialRendererRoutePath } from './window-context'

/** Whether this PC's tools are offered ("false" turns it off; on by default). */
export const DAHLIA_REMOTE_TOOLS_ENABLED_KEY = 'dahlia/remote-tools-enabled'
/** The connection state, for the Dahlia settings page in the other windows. */
export const DAHLIA_REMOTE_TOOLS_STATUS_KEY = 'dahlia/remote-tools-status'
/** "true": tools that change something run without asking on this PC (off by default). */
export const DAHLIA_REMOTE_TOOLS_UNATTENDED_KEY = 'dahlia/remote-tools-unattended'

/** The program each game was last started with, by game name: {"darkwarsurvival": "C:\\…\\Dark War.lnk"}. */
export const DAHLIA_GAME_PATHS_KEY = 'dahlia/game-paths'
/** How long a started game has to open its window; launchers often update first. */
const GAME_WINDOW_WAIT_MS = 45_000
/** Dark War's launcher, its Start button and the game window must fit in her server's 90 s device call. */
const DARK_WAR_LAUNCH_MS = 80_000

/** The read-only file server (resources/dahlia-files-mcp.mjs) needs no confirmation. */
const READ_ONLY_SERVERS = new Set(['dahlia-files'])

let started = false

function isMainWindow() {
  return resolveInitialRendererRoutePath('/') === '/'
}

function text(content: Array<Record<string, unknown>> | undefined) {
  return (content ?? []).map(part => typeof part.text === 'string' ? part.text : JSON.stringify(part)).join('\n')
}

/**
 * The window she last looked at (screenshot by title) or started (game_launch). A click with a window name that
 * matches nothing, or none, goes there: she once fumbled "the correct window reference" and her tap failed at once,
 * though she had just seen the game's Start button. Kept here, not in a tool list, which is built again on every poll.
 */
let lastDahliaWindow: string | undefined
/**
 * When she last saw each window (a screenshot of it), by title. A tap at positions she gives needs a fresh look: from
 * memory or a guess it lands anywhere (in tests, models tapped (500,500) to close a pop-up they hadn't looked at).
 */
const dahliaWindowSeenAt = new Map<string, number>()
/** How long a look at a window counts for a tap at positions. */
const SEEN_FOR_MS = 3 * 60_000
/** How long a tap's effect has to show before the window is compared with how it was. */
const TAP_SETTLE_MS = 1_200

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

  // PowerShell, in the main process (src/main/dahlia-powershell.ts).
  tools.push({
    name: 'powershell',
    description: 'Run a Windows PowerShell command on this PC and get its output (text, at most 16,000 characters). Use it for anything on the PC: files and folders, programs, processes, settings, system information, the network. It runs in the user\'s home folder, without a window, for at most the time given. It can\'t answer a password prompt: to log in to another machine over SSH, use the ssh tool.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The PowerShell command or script' },
        timeoutSeconds: { type: 'number', description: 'How long it may run, 1 to 300 seconds (default 60)' },
      },
      required: ['command'],
    },
    readOnly: false,
    askEachTime: true,
    run: async (args) => {
      const result = await window.electron.ipcRenderer.invoke('dahlia:powershell', { command: args.command, timeoutSeconds: args.timeoutSeconds }) as { ok: boolean, exitCode: number | null, output: string }
      const text = result.exitCode === null || result.exitCode === 0 ? result.output : `${result.output}\n(exit code ${result.exitCode})`
      if (!result.ok && result.exitCode === null)
        throw new Error(text)
      return text
    },
  })

  // SSH from this PC, in the main process (src/main/dahlia-ssh.ts). The login is this PC's key or a password
  // saved in Settings > Dahlia > SSH: she never sees or sends a password.
  const ssh = async (request: Record<string, unknown>) => {
    const result = await window.electron.ipcRenderer.invoke('dahlia:ssh', request) as { ok: boolean, exitCode: number | null, output: string }
    const text = result.exitCode === null || result.exitCode === 0 ? result.output : `${result.output}\n(exit code ${result.exitCode})`
    if (!result.ok && result.exitCode === null)
      throw new Error(text)
    return text
  }
  const sshTarget = {
    host: { type: 'string', description: 'The server: a host name or IP address, also as user@host or user@host:port' },
    user: { type: 'string', description: 'The user to log in as (unless the host says it)' },
    port: { type: 'number', description: 'The SSH port (default 22)' },
  }
  tools.push(
    {
      name: 'ssh',
      description: 'Run a command on another machine over SSH, from this PC, and get its output (at most 16,000 characters) and exit code. The login is this PC\'s key or a password the user saved on this PC (Settings > Dahlia > SSH); never ask for, write or send a password. The first connection to a server trusts its host key; a changed key is refused. Each call is a new login running one command (use && or ; for several).',
      inputSchema: {
        type: 'object',
        properties: {
          ...sshTarget,
          command: { type: 'string', description: 'The command to run on the server' },
          timeoutSeconds: { type: 'number', description: 'How long it may run, 1 to 300 seconds (default 60)' },
        },
        required: ['host', 'command'],
      },
      readOnly: false,
      askEachTime: true,
      run: args => ssh({ op: 'run', host: args.host, user: args.user, port: args.port, command: args.command, timeoutSeconds: args.timeoutSeconds }),
    },
    {
      name: 'ssh_key',
      description: 'Show this PC\'s SSH public key, making the key first if there is none (~/.ssh/id_ed25519, which ssh in PowerShell uses too). A server accepts logins with it once the key is in ~/.ssh/authorized_keys there: ssh_install_key adds it.',
      inputSchema: { type: 'object', properties: {} },
      readOnly: false,
      run: () => ssh({ op: 'key' }),
    },
    {
      name: 'ssh_install_key',
      description: 'Add this PC\'s SSH key to a server (its ~/.ssh/authorized_keys, for a Linux or other POSIX server), logging in with the password the user saved on this PC, and check that the key alone logs in. After that, logins to the server need no password.',
      inputSchema: { type: 'object', properties: sshTarget, required: ['host'] },
      readOnly: false,
      askEachTime: true,
      run: args => ssh({ op: 'install_key', host: args.host, user: args.user, port: args.port }),
    },
  )

  // nmap, in the main process (src/main/dahlia-network-scan.ts).
  tools.push({
    name: 'network_scan',
    description: 'Scan a network with nmap for security auditing and threat hunting on this PC: which hosts are up, which TCP ports are open, the services and versions behind them, and known-vulnerability detection. Give a host, an IP, a CIDR block (192.168.10.0/24) or a range (192.168.10.1-254). Reads only; it changes nothing on the target. For reading log files or running other PC commands, use the file tools or powershell.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'A host name, IP address, CIDR block or dash range' },
        scanType: { type: 'string', enum: ['discovery', 'ports', 'service', 'vuln'], description: 'discovery: which hosts are up. ports: open TCP ports. service: service and version. vuln: known-vulnerability detection. Default ports.' },
        ports: { type: 'string', description: 'The TCP ports, as nmap -p takes them (e.g. "22,80,443" or "1-1024"). Optional.' },
        timeoutSeconds: { type: 'number', description: 'How long it may run, 5 to 900 seconds (default 180)' },
      },
      required: ['target'],
    },
    readOnly: false,
    run: async (args) => {
      const result = await window.electron.ipcRenderer.invoke('dahlia:network-scan', { target: args.target, scanType: args.scanType, ports: args.ports, timeoutSeconds: args.timeoutSeconds }) as { ok: boolean, exitCode: number | null, output: string }
      const text = result.exitCode === null || result.exitCode === 0 ? result.output : `${result.output}\n(exit code ${result.exitCode})`
      if (!result.ok && result.exitCode === null)
        throw new Error(text)
      return text
    },
  })

  // Screenshots and recordings, in the main process and the recorder (src/main/dahlia-screen-capture.ts).
  tools.push(
    {
      name: 'screenshot',
      description: 'Take a screenshot of this PC and look at it: one window by its title (even behind other windows, on any screen, and games), the main screen, or another screen. To look at a game or an app, give its window title, such as "DarkWar" (Dark War: Survival; its launcher is "Dark War"): without one you see only the main screen, and the window may be on another screen or behind others. You see the picture.',
      inputSchema: {
        type: 'object',
        properties: {
          window: { type: 'string', description: 'Text in the window\'s title, such as "DarkWar" (the game) or "Notepad" (optional; the screen when not given)' },
          screen: { type: 'number', description: 'Which screen, 1, 2, … (optional; the main one by default)' },
        },
      },
      readOnly: true,
      run: async (args) => {
        // A window is grabbed by the window helper (bring to front, copy its frame from the screen); a whole
        // screen goes through Windows Graphics Capture (dahlia-screen-recorder). Both read GPU-drawn games,
        // which the desktop capturer's own thumbnail returns black for.
        let shot
        try {
          shot = await grabDahliaScreenshot({
            window: typeof args.window === 'string' ? args.window : undefined,
            screen: typeof args.screen === 'number' ? args.screen : undefined,
          })
        }
        catch (error) {
          // Be blunt so a blank or failed capture is never written up as if she saw the screen.
          throw new Error(`${(error as Error).message || 'The screenshot failed.'} You did not see the screen this time, so do not describe or guess what is on it; say the capture failed and try again.`)
        }
        if (typeof args.window === 'string' && args.window.trim()) {
          lastDahliaWindow = shot.title
          dahliaWindowSeenAt.set(shot.title, Date.now())
          return { text: `Screenshot of the window "${shot.title}" (${shot.width}×${shot.height}). To click in it, use tap with window "${shot.title}" and target (what to click), or positions from 0 to 1000 across this picture.`, images: [shot.image] }
        }
        return { text: `Screenshot of the whole screen "${shot.title}" (${shot.width}×${shot.height}). Positions in it don't line up with a window: to click in a window, take a screenshot of that window by its title first.`, images: [shot.image] }
      },
    },
    {
      name: 'screen_record',
      description: `Record a video of one window (by its title) or a screen of this PC, up to ${MAX_RECORDING_SECONDS} seconds, the way OBS does. It is saved as an MP4 in the user's Videos\\Dahlia folder; you see its last frame.`,
      inputSchema: {
        type: 'object',
        properties: {
          window: { type: 'string', description: 'Text in the window\'s title (optional; the screen when not given)' },
          screen: { type: 'number', description: 'Which screen, 1, 2, … (optional; the main one by default)' },
          seconds: { type: 'number', description: `How long, 1 to ${MAX_RECORDING_SECONDS} seconds (default 10)` },
        },
      },
      readOnly: false,
      run: async (args) => {
        const recording = await recordDahliaScreen({
          window: typeof args.window === 'string' ? args.window : undefined,
          screen: typeof args.screen === 'number' ? args.screen : undefined,
          seconds: typeof args.seconds === 'number' ? args.seconds : undefined,
        })
        const text = `Recorded "${recording.title}" for ${recording.seconds} s: ${recording.path} (${(recording.bytes / 1_048_576).toFixed(1)} MB).`
        return recording.still ? { text: `${text} Its last frame:`, images: [recording.still] } : text
      },
    },
  )

  // Finding and starting games, in the main process (src/main/dahlia-game-launcher.ts).
  interface GameCandidate { path: string, target?: string, source: string }
  const findGame = async (name: string, folder?: string) => {
    const answer = await window.electron.ipcRenderer.invoke('dahlia:game-launcher', { op: 'find', name, folder }) as { ok: boolean, error?: string, candidates?: GameCandidate[] }
    if (!answer.ok)
      throw new Error(answer.error ?? 'The search failed.')
    return answer.candidates ?? []
  }
  const describeCandidates = (candidates: GameCandidate[]) => candidates
    .map((candidate, i) => `${i + 1}. ${candidate.path}${candidate.target ? ` (starts ${candidate.target})` : ''} [${candidate.source}]`)
    .join('\n')
  const gameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const rememberedGames = () => {
    try {
      return JSON.parse(localStorage.getItem(DAHLIA_GAME_PATHS_KEY) ?? '{}') as Record<string, string>
    }
    catch {
      return {}
    }
  }
  interface FoundWindow { ok: boolean, hwnd?: number, title?: string }
  const findWindow = async (title: string) => {
    const found = await window.electron.ipcRenderer.invoke('dahlia:window', { op: 'find', title }) as FoundWindow
    return found.ok && found.hwnd ? found : undefined
  }
  /**
   * The window with this very title (case aside). The helper compares titles without their spaces, so a search
   * for "DarkWar" also finds the launcher "Dark War" when the game isn't open; this tells them apart.
   */
  const findExactWindow = async (title: string) => {
    const found = await findWindow(title)
    return found?.title?.trim().toLowerCase() === title.toLowerCase() ? found : undefined
  }
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  /** Waits for a window (looks at least once), then brings it forward: started isn't the same as open. Its title, or undefined. */
  const showWindowWithin = async (title: string, ms: number) => {
    const until = Date.now() + ms
    for (;;) {
      const found = await findWindow(title)
      if (found) {
        await window.electron.ipcRenderer.invoke('dahlia:window', { op: 'show', hwnd: found.hwnd })
        lastDahliaWindow = found.title
        return found.title ?? title
      }
      if (Date.now() + 2_000 > until)
        return undefined
      await pause(2_000)
    }
  }
  /**
   * Dark War opens a launcher first (the window "Dark War"); its yellow Start button opens the game window
   * ("DarkWar"). Her server finds the button on a picture of the launcher, and this clicks it.
   */
  const startDarkWar = async (file?: string) => {
    const started = file ? `Started ${file}` : 'The game or its launcher was already open'
    const until = Date.now() + DARK_WAR_LAUNCH_MS
    let clicked = false
    while (Date.now() < until) {
      const game = await findExactWindow(DARK_WAR_WINDOW_TITLE)
      if (game) {
        await window.electron.ipcRenderer.invoke('dahlia:window', { op: 'show', hwnd: game.hwnd })
        lastDahliaWindow = game.title
        return `${started}${clicked ? ' and clicked Start in its launcher' : ''}. The game window "${game.title}" is open and in front: play in it, not in the launcher.`
      }

      const launcher = clicked ? undefined : await findExactWindow(DARK_WAR_LAUNCHER_TITLE)
      if (launcher?.hwnd) {
        await window.electron.ipcRenderer.invoke('dahlia:window', { op: 'show', hwnd: launcher.hwnd })
        // With the words Windows reads on it, her server finds Start by its text instead of asking her model.
        const capture = await window.electron.ipcRenderer.invoke('dahlia:window', { op: 'capture', hwnd: launcher.hwnd, maxHeight: 1024, ocr: true }) as { ok: boolean, png?: string, words?: unknown }
        const start = capture.ok && capture.png ? await locateInGame(DARK_WAR_START_BUTTON, capture.png, parseScreenWords(capture.words)).catch(() => undefined) : undefined
        if (start) {
          await window.electron.ipcRenderer.invoke('dahlia:window', { op: 'tap', hwnd: launcher.hwnd, x: start.x, y: start.y })
          clicked = true
        }
      }
      await pause(2_000)
    }
    return clicked
      ? `${started} and clicked Start in its launcher ("${DARK_WAR_LAUNCHER_TITLE}"), but the game window "${DARK_WAR_WINDOW_TITLE}" hasn't opened yet. It may still be loading or updating; check with a screenshot of window "${DARK_WAR_WINDOW_TITLE}" before saying it is open.`
      : `${started}, but the game didn't start from it: ${await findExactWindow(DARK_WAR_LAUNCHER_TITLE) ? `the yellow Start button wasn't found in the launcher window "${DARK_WAR_LAUNCHER_TITLE}"` : `no launcher window "${DARK_WAR_LAUNCHER_TITLE}" opened`}. Take a screenshot with window "${DARK_WAR_LAUNCHER_TITLE}" and tap its yellow Start button yourself; the launcher may be updating first.`
  }
  tools.push(
    {
      name: 'game_find',
      description: `Search this PC for a game's program or shortcut: Start menu and desktop shortcuts, installed programs, Program Files, Steam and Epic libraries and game folders on every drive. Best match first. Default game: ${DARK_WAR_SURVIVAL_NAME}.`,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: `The game's name (default "${DARK_WAR_SURVIVAL_NAME}")` },
          folder: { type: 'string', description: 'Also search this folder, deeper (optional)' },
        },
      },
      readOnly: true,
      run: async (args) => {
        const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : DARK_WAR_SURVIVAL_NAME
        const candidates = await findGame(name, typeof args.folder === 'string' ? args.folder : undefined)
        return candidates.length > 0
          ? `Found for "${name}":\n${describeCandidates(candidates)}`
          : `Nothing named like "${name}" is installed in the usual places. Ask the user where it is, then search that folder.`
      },
    },
    {
      name: 'game_launch',
      description: `Start a game on this PC and bring its window to the front. Without a path, it starts the program used last time for that game, or the best match game_find finds. Default game: ${DARK_WAR_SURVIVAL_NAME}: it opens its launcher (the window "${DARK_WAR_LAUNCHER_TITLE}"), clicks the launcher's yellow Start button for you and waits for the game window ("${DARK_WAR_WINDOW_TITLE}"). To play it yourself afterwards, use game_play.`,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: `The game's name (default "${DARK_WAR_SURVIVAL_NAME}")` },
          path: { type: 'string', description: 'The full path of the program or shortcut to start, from game_find (optional)' },
        },
      },
      readOnly: false,
      run: async (args) => {
        const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : DARK_WAR_SURVIVAL_NAME
        const title = gameKey(name) === gameKey(DARK_WAR_SURVIVAL_NAME) ? DARK_WAR_WINDOW_TITLE : name
        const nextStep = `If it shows a launcher, take a screenshot with window "${title}" and tap its start button.`

        // Dark War: the game window already open, or only its launcher (then only its Start button is left).
        const darkWar = gameKey(name) === gameKey(DARK_WAR_SURVIVAL_NAME)
        if (darkWar && (await findExactWindow(DARK_WAR_WINDOW_TITLE) || await findExactWindow(DARK_WAR_LAUNCHER_TITLE)))
          return await startDarkWar()

        // Already open: bring it forward instead of starting a second copy (Dark War's launcher only answers
        // "Launcher is Running" to a second start).
        const open = darkWar ? undefined : await window.electron.ipcRenderer.invoke('dahlia:window', { op: 'find', title }) as { ok: boolean, hwnd?: number, title?: string }
        if (open?.ok && open.hwnd) {
          await window.electron.ipcRenderer.invoke('dahlia:window', { op: 'show', hwnd: open.hwnd })
          lastDahliaWindow = open.title
          return `${name} is already running; its window "${open.title}" is in front now. ${nextStep}`
        }

        // Her path is a hint, not the only try: she once passed the game's folder, which can't start, and the tool
        // gave up instead of looking (see dahlia-game-start.ts).
        const remembered = rememberedGames()
        const { file, tried, lastError } = await startGameProgram({
          given: typeof args.path === 'string' && args.path.trim() ? args.path.trim() : undefined,
          remembered: remembered[gameKey(name)],
          searchIn: async folder => (await findGame(name, folder).catch(() => []))[0]?.path,
          search: async () => (await findGame(name))[0]?.path,
          launch: async candidate => await window.electron.ipcRenderer.invoke('dahlia:game-launcher', { op: 'launch', path: candidate }) as { ok: boolean, error?: string },
        })
        if (!file) {
          throw new Error(tried > 0
            ? `${name} didn't start (${lastError ?? 'no reason given'}). Ask the user where the game's program is, then use game_find with that folder.`
            : `${name} isn't installed in the usual places. Ask the user where it is, then use game_find with that folder.`)
        }
        localStorage.setItem(DAHLIA_GAME_PATHS_KEY, JSON.stringify({ ...remembered, [gameKey(name)]: file }))

        if (darkWar)
          return await startDarkWar(file)

        // Wait for its window, then bring it forward: started isn't the same as open.
        const shown = await showWindowWithin(title, GAME_WINDOW_WAIT_MS)
        return shown
          ? `Started ${file}. Its window "${shown}" is open and in front. ${nextStep}`
          : `Started ${file}, but no window with "${title}" in its title opened within ${GAME_WINDOW_WAIT_MS / 1000} s. It may still be loading or updating; check with screenshot before saying it is open.`
      },
    },
  )

  // Clicking, dragging and key presses in a window, through the window helper (src/main/dahlia-window-helper.ts).
  // She sees the window with the screenshot tool, then points to a spot as 0-1000 across the window she saw.
  // The window helper taps the same visible window the capture shows, so the positions line up.
  const windowRequest = async (request: Record<string, unknown>) => {
    const answer = await window.electron.ipcRenderer.invoke('dahlia:window', request) as { ok: boolean, error?: string, [field: string]: unknown }
    if (!answer.ok)
      throw new Error(answer.error ?? 'The window helper failed.')
    return answer
  }
  const windowHwnd = async (title: string) => {
    const wanted = title.trim()
    const find = async (text: string | undefined) => {
      const found = text ? await windowRequest({ op: 'find', title: text, anyApp: true }).catch(() => undefined) : undefined
      return found?.ok && found.hwnd ? { hwnd: found.hwnd as number, title: found.title as string } : undefined
    }
    const found = await find(wanted) ?? (lastDahliaWindow !== wanted ? await find(lastDahliaWindow) : undefined)
    if (!found) {
      throw new Error(`No open window has "${wanted}" in its title${lastDahliaWindow && lastDahliaWindow !== wanted ? `, and "${lastDahliaWindow}" is closed` : ''}. `
        + `Take a screenshot with the window's title, such as "${DARK_WAR_WINDOW_TITLE}" (the game) or "${DARK_WAR_LAUNCHER_TITLE}" (its launcher), then tap with that same title.`)
    }
    lastDahliaWindow = found.title
    return found
  }
  const POSITION = 'from 0 (left/top) to 1000 (right/bottom) across the window you saw'
  const FOUND_BY: Record<string, string> = { text: 'by its text', shape: 'by its shape', model: 'by your model' }
  /** Whether the window changed after a tap (a small thumbnail compared), as a sentence for her. */
  const afterTap = async (hwnd: number, before?: string) => {
    await pause(TAP_SETTLE_MS)
    const after = await grabDahliaScreenshot({ hwnd, maxHeight: 360 }).catch(() => undefined)
    if (!before || !after?.sig)
      return 'Take a screenshot to see what changed before saying what happened.'
    return screenChanged(before, after.sig)
      ? 'The window changed after the click.'
      : 'The window looks the same after the click: it may have done nothing; take a screenshot before trying again.'
  }
  tools.push(
    {
      name: 'tap',
      description: `Click something in a window on this PC (a left click; it also taps touch-style apps and games such as ${DARK_WAR_SURVIVAL_NAME}). Say what to click in target, such as "the X that closes the pop-up" or "the Start button": the PC looks at the window itself and finds it by its text, a close X by its shape, or else asks your model, so you don't need a screenshot first. Only with x and y instead (${POSITION}), take a screenshot of that window by its title first.`,
      inputSchema: {
        type: 'object',
        properties: {
          window: { type: 'string', description: `Text in the window's title, such as "${DARK_WAR_WINDOW_TITLE}" (the game) or "${DARK_WAR_LAUNCHER_TITLE}" (its launcher)` },
          target: { type: 'string', description: 'What to click, precisely, such as "the X in the corner of the offer pop-up" or "the Claim button" (it is found for you)' },
          x: { type: 'number', description: `Across, ${POSITION} (only without target)` },
          y: { type: 'number', description: `Down, ${POSITION} (only without target)` },
        },
        required: ['window'],
      },
      readOnly: false,
      run: async (args) => {
        const { hwnd, title } = await windowHwnd(String(args.window ?? ''))
        const target = typeof args.target === 'string' ? args.target.trim() : ''

        // What to click, found on a picture the PC takes now: no guessing, and her model isn't asked when the
        // target's text or a close X is on it.
        if (target.length >= 3) {
          const shot = await grabDahliaScreenshot({ hwnd, maxHeight: 1024, ocr: true })
          const game = title.replace(/\s+/g, '').toLowerCase() === DARK_WAR_WINDOW_TITLE.toLowerCase() ? DARK_WAR_SURVIVAL : ''
          const spot = await locateInGame(target, shot.image.slice(shot.image.indexOf(',') + 1), shot.words, game)
          if (!spot) {
            dahliaWindowSeenAt.set(title, Date.now())
            return { text: `${target} wasn't found in "${title}", so nothing was clicked. This is the window now: tap again with a clearer target, or with x and y from this picture.`, images: [shot.image] }
          }
          await windowRequest({ op: 'tap', hwnd, x: spot.x, y: spot.y })
          dahliaWindowSeenAt.delete(title)
          return `Clicked ${target} at ${spot.x},${spot.y} in "${title}" (found ${FOUND_BY[spot.by ?? ''] ?? 'on the screen'}). ${await afterTap(hwnd, shot.sig)}`
        }

        const x = Number(args.x)
        const y = Number(args.y)
        if (args.x === undefined || args.y === undefined || !Number.isFinite(x) || !Number.isFinite(y))
          throw new Error('Say what to click in target (such as "the X that closes the pop-up"), or give x and y from a screenshot of the window.')

        // Positions need a fresh look at the window: without one, take it now instead of clicking blind.
        const seen = dahliaWindowSeenAt.get(title)
        if (seen === undefined || Date.now() - seen > SEEN_FOR_MS) {
          const shot = await grabDahliaScreenshot({ hwnd })
          dahliaWindowSeenAt.set(title, Date.now())
          return { text: `You hadn't looked at "${title}" yet, so nothing was clicked: a guessed spot lands anywhere. This is the window now. Tap again with target (what to click; it is found for you) or with x and y from this picture.`, images: [shot.image] }
        }

        const before = await grabDahliaScreenshot({ hwnd, maxHeight: 360 }).catch(() => undefined)
        await windowRequest({ op: 'tap', hwnd, x, y })
        // The picture she saw is out of date now.
        dahliaWindowSeenAt.delete(title)
        return `Clicked ${Math.round(x)},${Math.round(y)} in "${title}". ${await afterTap(hwnd, before?.sig)}`
      },
    },
    {
      name: 'swipe',
      description: `Drag from one spot to another in a window (a scroll or a swipe). Take a screenshot first. All positions are ${POSITION}.`,
      inputSchema: {
        type: 'object',
        properties: {
          window: { type: 'string', description: 'Text in the window\'s title' },
          x1: { type: 'number', description: 'Start across (0-1000)' },
          y1: { type: 'number', description: 'Start down (0-1000)' },
          x2: { type: 'number', description: 'End across (0-1000)' },
          y2: { type: 'number', description: 'End down (0-1000)' },
          ms: { type: 'number', description: 'How long the drag takes in milliseconds (default 400)' },
        },
        required: ['window', 'x1', 'y1', 'x2', 'y2'],
      },
      readOnly: false,
      run: async (args) => {
        const { hwnd, title } = await windowHwnd(String(args.window ?? ''))
        await windowRequest({ op: 'swipe', hwnd, x1: Number(args.x1) || 0, y1: Number(args.y1) || 0, x2: Number(args.x2) || 0, y2: Number(args.y2) || 0, ms: Math.round(Number(args.ms) || 400) })
        return `Dragged in "${title}". Take a screenshot to see what changed.`
      },
    },
    {
      name: 'press_key',
      description: 'Press Escape, Enter or Space in a window on this PC (for a back button, confirming, or closing a popup). Take a screenshot first.',
      inputSchema: {
        type: 'object',
        properties: {
          window: { type: 'string', description: 'Text in the window\'s title' },
          key: { type: 'string', enum: ['escape', 'enter', 'space'], description: 'Which key' },
        },
        required: ['window', 'key'],
      },
      readOnly: false,
      run: async (args) => {
        const key = args.key === 'enter' || args.key === 'space' ? args.key : 'escape'
        const { hwnd, title } = await windowHwnd(String(args.window ?? ''))
        await windowRequest({ op: 'key', hwnd, key })
        return `Pressed ${key} in "${title}".`
      },
    },
  )

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
      const watching = dahliaGameWatcher()?.state
      if (watching?.running)
        lines.push(`Watching Aleytia play: ${watching.samples} of her clicks kept so far.`)
      else if (watching?.ended)
        lines.push(`Last time you watched her play: ${watching.ended}`)
      return lines.join('\n')
    }
    tools.push(
      {
        name: 'game_play',
        description: 'Start playing Dark War: Survival on this PC by yourself, or give the running session a new goal or time. Its portrait game window ("DarkWar", not the launcher "Dark War") must be open on the PC (start it with game_launch first). You make one move every few seconds, keep notes about the game for next time, and stop when nothing is left to do (or when the time is up, if a time was given). With no time, you play until you are done or are stopped.',
        inputSchema: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'What to do in the game, such as "collect rewards and upgrade the headquarters" (optional)' },
            minutes: { type: 'number', description: 'How long to play, in minutes (optional; with none, play with no time limit until done or stopped)' },
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
        description: 'Whether you are playing Dark War: Survival on this PC, or watching Aleytia play it, and your latest moves.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: async () => status(),
      },
      {
        name: 'game_watch',
        description: 'Watch Aleytia play Dark War: Survival on this PC, to learn the game from her: while its window is in front, each of her clicks and drags in it is kept with the screen before and after it, you describe some of them as they come, and when watching ends you write down what you learned as notes for the game. Use it when she asks you to watch or learn from her. Her clicks elsewhere and her keys are not recorded.',
        inputSchema: {
          type: 'object',
          properties: {
            minutes: { type: 'number', description: 'How long to watch, 1 to 240 minutes (default 60)' },
          },
        },
        readOnly: false,
        run: async (args) => {
          const state = startWatchingDahliaGame({ minutes: typeof args.minutes === 'number' ? args.minutes : undefined })
          return `Watching. ${state.log.at(-1) ?? 'Looking for the game window.'} Tell Aleytia to play as usual; game_watch_stop ends it.`
        },
      },
      {
        name: 'game_watch_stop',
        description: 'Stop watching Aleytia play Dark War: Survival; you then write down what you learned.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: async () => {
          dahliaGameWatcher()?.stop('Stopped when asked.')
          return 'Stopping. Your notes from watching are written in the next minutes; game_status shows when they are done.'
        },
      },
    )
  }

  if (dahliaScreenWatcher()) {
    tools.push(
      {
        name: 'screen_watch',
        description: 'Keep an eye on this PC\'s screen until told to stop: every 15 seconds, or every second while Aleytia plays a game (game: true), when the screen changed, you note what it shows, and your newest note is in front of you in every reply, so you know what Aleytia is doing without a screenshot each time. Use it when she asks you to watch her screen, keep her company while she works, or tell her when something shows up. Nothing is recorded or kept; screen_watch_stop ends it. For a look right now, or to read details, use screenshot.',
        inputSchema: {
          type: 'object',
          properties: {
            game: { type: 'boolean', description: 'true while she plays a game: a look every second instead of every 15 seconds' },
            minutes: { type: 'number', description: 'Stop by yourself after this many minutes (optional; without it you watch until screen_watch_stop)' },
            seconds: { type: 'number', description: 'How often to look, in seconds (optional; 15, or 1 for a game)' },
            screen: { type: 'number', description: 'Which screen, 1, 2, … (optional; the main one by default)' },
            watch_for: { type: 'array', items: { type: 'string' }, description: 'Words or short phrases to look out for on the screen, such as "build failed" or "download complete" (optional; replaces the earlier list, [] clears it). When one appears you look at once and your note says what it is about.' },
          },
        },
        readOnly: false,
        run: async (args) => {
          if (Array.isArray(args.watch_for))
            setDahliaScreenInterests(args.watch_for)
          const state = startWatchingDahliaScreen({
            game: args.game === true,
            minutes: typeof args.minutes === 'number' ? args.minutes : undefined,
            seconds: typeof args.seconds === 'number' ? args.seconds : undefined,
            screen: typeof args.screen === 'number' ? args.screen : undefined,
          })
          const until = state.endsAt ? `until ${new Date(state.endsAt).toLocaleTimeString()}` : 'until you stop'
          const interests = dahliaScreenInterests()
          const lookingFor = interests.length > 0 ? ` Looking out for: ${interests.join(', ')}.` : ''
          return `Watching the screen ${until}, a capture every ${state.seconds === 1 ? 'second' : `${state.seconds} seconds`}; you look when the window in front, the text or a problem on it is new.${lookingFor} Your first note of it arrives shortly; screen_watch_stop ends it.`
        },
      },
      {
        // Her server calls this, never her model (DeviceToolBroker.IsInternal): a coding agent's state.
        name: 'assistant_state',
        description: 'Dahlia\'s server only: shows on the avatar what a coding agent is doing.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: true },
        readOnly: true,
        run: async (args) => {
          const reaction = dahliaAssistantReactionsEnabled() ? dahliaAssistantReaction(args) : undefined
          if (!reaction)
            return 'Not shown.'
          await useLlmStreamingControlStore().dispatchWith(`<|ACT:${JSON.stringify({ emotion: reaction.emotion })}|>`)
          if (reaction.caption) {
            const captions = new BroadcastChannel('airi-caption-overlay')
            captions.postMessage({ type: 'caption-assistant', text: reaction.caption })
            captions.close()
          }
          if (reaction.animation)
            sendDahliaAnimationCommand({ op: 'play', name: reaction.animation })
          return 'Shown.'
        },
      },
      {
        name: 'avatar_animation',
        description: 'Play one of the animations of your 3D avatar\'s library on this PC (a wave, a dance, …), or list them. It comes with poses and dances, and Aleytia can add more in Settings > Dahlia. Call it without a name to see which there are.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The animation to play, as the list names it (optional; without it you get the list)' },
            loop: { type: 'boolean', description: 'true to repeat it until stopped (optional; once by default)' },
            stop: { type: 'boolean', description: 'true to stop the animation that plays and return to standing' },
          },
        },
        readOnly: true,
        run: async (args) => {
          const names = (await listDahliaAnimations()).map(entry => entry.name)
          if (args.stop === true) {
            sendDahliaAnimationCommand({ op: 'stop' })
            return 'Stopped the animation.'
          }
          if (typeof args.name !== 'string' || !args.name.trim())
            return names.length > 0 ? `Your animations: ${names.join(', ')}.` : 'Your animation library is empty. Aleytia can add .vrma files in Settings > Dahlia.'
          const name = findDahliaAnimation(names, args.name)
          if (!name)
            return `You have no animation "${args.name}". ${names.length > 0 ? `Your animations: ${names.join(', ')}.` : 'Your animation library is empty.'}`
          sendDahliaAnimationCommand({ op: 'play', name, loop: args.loop === true })
          return `Playing ${name}${args.loop === true ? ' until stopped' : ''}. It shows on your 3D avatar.`
        },
      },
      {
        name: 'screen_watch_stop',
        description: 'Stop keeping an eye on this PC\'s screen, or see whether you are watching it and your newest note.',
        inputSchema: { type: 'object', properties: { status: { type: 'boolean', description: 'true to only see the state, without stopping' } } },
        readOnly: true,
        run: async (args) => {
          const watching = dahliaScreenWatcher()!
          const state = watching.state
          const note = state.lastSummary ? ` Your newest note:\n${state.lastSummary}` : ''
          if (args.status === true)
            return state.running ? `Watching ${state.source ?? 'the screen'}: ${state.looks} looks so far.${note}` : `Not watching. ${state.ended ?? ''}`.trim()
          if (!state.running)
            return `You weren't watching the screen. ${state.ended ?? ''}`.trim()
          await watching.stop()
          return `Stopped watching the screen after ${state.looks} looks.`
        },
      },
    )
  }

  tools.push(...workflowTools())

  return tools
}

/**
 * The browser for the owner's ticket work, in the main process (src/main/dahlia-workflow-browser.ts): Chrome reading
 * the ticket mail in Outlook and the tickets in ConnectWise, and adding a note once the owner approved it on the
 * Tickets page. Her server calls these itself (Gateway/Workflows.cs) and never offers them to her chat, so they
 * don't ask here: the approval was the asking.
 */
function workflowTools(): DahliaRemoteTool[] {
  const step = async (op: string, args: Record<string, unknown>) => {
    const result = await window.electron.ipcRenderer.invoke('dahlia:workflow', { ...args, op }) as { ok: true, answer: Record<string, unknown>, image?: string } | { ok: false, error: string }
    if (!result.ok)
      throw new Error(result.error)
    const text = JSON.stringify(result.answer)
    return result.image ? { text, images: [result.image] } : text
  }
  const tool = (name: string, op: string, description: string): DahliaRemoteTool => ({
    name,
    description,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    readOnly: true,
    run: args => step(op, args),
  })
  return [
    tool('workflow_mail_list', 'mail_list', 'Dahlia\'s server only: the newest messages of the ticket folder in Outlook on the web.'),
    tool('workflow_mail_open', 'mail_open', 'Dahlia\'s server only: opens a message in Outlook on the web and reads it.'),
    tool('workflow_ticket_read', 'ticket_read', 'Dahlia\'s server only: reads a ticket\'s page in ConnectWise.'),
    tool('workflow_ticket_note', 'ticket_note', 'Dahlia\'s server only: adds an approved note to a ticket in ConnectWise.'),
  ]
}

function confirmCall(tool: DahliaRemoteTool, args: Record<string, unknown>) {
  const details = JSON.stringify(args, null, 2)
  const remembered = tool.askEachTime ? 'Dahlia asks again for every command.' : 'It then runs without asking for 10 minutes.'
  // A native dialog of this window: the call waits for the user here, whatever the app shows.
  // eslint-disable-next-line no-alert
  return Promise.resolve(window.confirm(
    `Dahlia wants to use "${tool.name}" on this PC, for a request from another device:\n\n`
    + `${details.length > 600 ? `${details.slice(0, 600)}…` : details}\n\n`
    + `Allow it? ${remembered}`,
  ))
}

/** Starts offering this PC's tools, in the main window only (every window runs this code). */
export function startDahliaRemoteTools() {
  // Every window can tell the PC's host name, which Settings > Dahlia shows as the default name.
  registerDahliaSystemName(() => window.electron.ipcRenderer.invoke('dahlia:host-name') as Promise<string>)
  // The main process's errors, crashed processes and native crash dumps (src/main/dahlia-error-reports.ts): the first
  // window that asks takes them, and its reporter sends them to Dahlia's server.
  registerDahliaErrorSource(() => window.electron.ipcRenderer.invoke('dahlia:error-reports:take') as Promise<DahliaErrorSourceResult>)
  // Settings > Dahlia > SSH, in the settings window too.
  registerDahliaSsh(request => window.electron.ipcRenderer.invoke('dahlia:ssh-settings', request) as Promise<DahliaSshSettings>)
  // Settings > Modules > Tickets: Chrome opens for signing in to Outlook and ConnectWise (src/main/dahlia-workflow-browser.ts).
  registerDahliaWorkflowSignIn(async (urls, browser) => {
    // Only plain values cross the IPC: a reactive proxy from a page can't be cloned.
    const request = { op: 'signin', urls: urls.map(String), browser: { channel: browser?.channel, headless: browser?.headless === true } }
    const result = await window.electron.ipcRenderer.invoke('dahlia:workflow', request) as { ok: boolean, error?: string }
    if (!result.ok)
      throw new Error(result.error ?? 'Chrome didn\'t open.')
  })
  if (started || !isMainWindow())
    return
  started = true

  let hostName: string | undefined
  void dahliaSystemName().then(name => hostName = name)

  const remote = new DahliaRemoteTools({
    serverUrl: SERVER_URL,
    // The session after a voice check on this PC; after the first one the server knows this PC, and the
    // key keeps it connected while the sessions come and go.
    getKey: () => dahliaBearer() || undefined,
    deviceId: dahliaDeviceId(),
    deviceName: () => dahliaDeviceName(hostName, 'Windows PC'),
    platform: 'Windows',
    enabled: () => localStorage.getItem(DAHLIA_REMOTE_TOOLS_ENABLED_KEY) !== 'false',
    listTools,
    confirm: confirmCall,
    runWithoutAsking: () => localStorage.getItem(DAHLIA_REMOTE_TOOLS_UNATTENDED_KEY) === 'true',
    onState: (state: DahliaRemoteToolsState, toolCount: number) => {
      const value = JSON.stringify({ state, tools: toolCount })
      if (localStorage.getItem(DAHLIA_REMOTE_TOOLS_STATUS_KEY) !== value)
        localStorage.setItem(DAHLIA_REMOTE_TOOLS_STATUS_KEY, value)
    },
  })
  remote.start()
}
