// Dahlia: the quick chat beside the tray icon. "Quick chat" in the tray menu opens a small chat window next to the
// icon, with the desktop chat in it and nothing else; it goes away when another window takes the focus, unless it is
// pinned. After the tray popover of dasilva333/airi ("AIRI Pocket"), with its chat tab only.
// This file is Dahlia's (AIRI has no such file).

import type { Rectangle } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { McpManager } from '../../services/airi/mcp-servers'
import type { SettingsWindowManager } from '../settings'
import type { WidgetsWindowManager } from '../widgets'

import { BrowserWindow, ipcMain, screen } from 'electron'
import { isMacOS } from 'std-env'

import icon from '../../../../resources/icon.png?asset'

import { baseUrl, getPreloadPath, getRendererRoot, load, withHashRoute } from '../../libs/electron/location'
import { createWindowContext } from '../../libs/electron/window-context'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { setupChatWindowElectronInvokes } from '../chat/rpc/index.electron'
import { protectPrivilegedWindowNavigation } from '../shared'

export const DAHLIA_QUICK_CHAT_CHANNEL = 'dahlia:quick-chat'
export const QUICK_CHAT_WIDTH = 380
export const QUICK_CHAT_HEIGHT = 560
const GAP = 6

/** Where the quick chat goes: centred on the tray icon, on the side of the screen's edge the taskbar is on, inside the work area. */
export function quickChatPosition(tray: Rectangle, workArea: Rectangle, size = { width: QUICK_CHAT_WIDTH, height: QUICK_CHAT_HEIGHT }) {
  const centreX = tray.x + tray.width / 2
  const centreY = tray.y + tray.height / 2
  // The tray is outside the work area, on the taskbar's side.
  let x = Math.round(centreX - size.width / 2)
  let y = centreY > workArea.y + workArea.height / 2 ? workArea.y + workArea.height - size.height - GAP : workArea.y + GAP
  if (tray.x >= workArea.x + workArea.width)
    x = workArea.x + workArea.width - size.width - GAP
  else if (tray.x + tray.width <= workArea.x)
    x = workArea.x + GAP
  if (tray.x >= workArea.x + workArea.width || tray.x + tray.width <= workArea.x)
    y = Math.round(centreY - size.height / 2)
  x = Math.min(Math.max(workArea.x + GAP, x), workArea.x + workArea.width - size.width - GAP)
  y = Math.min(Math.max(workArea.y + GAP, y), workArea.y + workArea.height - size.height - GAP)
  return { x, y }
}

export interface DahliaQuickChat {
  /** Shows the quick chat beside the tray icon, or hides it when it shows. */
  toggle: (trayBounds?: Rectangle) => Promise<void>
}

export function setupDahliaQuickChat(params: {
  widgetsManager: WidgetsWindowManager
  serverChannel: ServerChannel
  mcpManager: McpManager
  i18n: I18n
  openSettingsWindow: SettingsWindowManager['openWindow']
  /** Opens the full chat, in the mode the person chose. */
  openChat: () => Promise<void>
}): DahliaQuickChat {
  let pinned = false
  let current: BrowserWindow | undefined

  const reusable = createReusableWindow(async () => {
    const window = new BrowserWindow({
      title: 'Dahlia',
      width: QUICK_CHAT_WIDTH,
      height: QUICK_CHAT_HEIGHT,
      minWidth: 300,
      minHeight: 360,
      show: false,
      frame: false,
      skipTaskbar: true,
      fullscreenable: false,
      icon,
      ...(isMacOS ? { transparent: true, backgroundColor: '#00000000' } : {}),
      webPreferences: {
        preload: getPreloadPath(),
        sandbox: false,
      },
    })
    window.setAlwaysOnTop(true, 'pop-up-menu')
    protectPrivilegedWindowNavigation(window)
    current = window
    window.on('closed', () => {
      if (current === window)
        current = undefined
    })
    // Like a tray popover, it goes when the person clicks elsewhere, unless they pinned it.
    window.on('blur', () => {
      if (!pinned && !window.webContents.isDevToolsOpened())
        window.hide()
    })

    const { context } = createWindowContext(window)
    try {
      await setupChatWindowElectronInvokes({ context, window, ...params })
      await load(window, withHashRoute(baseUrl(getRendererRoot()), '/dahlia-quick-chat', {
        query: {
          'stage-runtime': 'minimal',
          'synced-leader': 'false',
        },
      }))
    }
    catch (error) {
      window.destroy()
      throw error
    }
    return window
  })

  ipcMain.handle(DAHLIA_QUICK_CHAT_CHANNEL, async (event, op: unknown) => {
    // Only the quick chat's own page drives it.
    const window = current
    if (!window || window.isDestroyed() || event.sender !== window.webContents)
      return undefined
    switch (op) {
      case 'pin':
        pinned = !pinned
        return pinned
      case 'pinned':
        return pinned
      case 'hide':
        window.hide()
        return pinned
      case 'full':
        window.hide()
        await params.openChat()
        return pinned
      default:
        return pinned
    }
  })

  return {
    async toggle(trayBounds) {
      const window = await reusable.getWindow()
      if (window.isVisible() && window.isFocused()) {
        window.hide()
        return
      }
      // Without the tray's place (some Linux trays don't say), the pointer is where the person clicked.
      const tray: Rectangle = trayBounds && trayBounds.width > 0 ? trayBounds : { ...screen.getCursorScreenPoint(), width: 1, height: 1 }
      const { workArea } = screen.getDisplayNearestPoint({ x: tray.x, y: tray.y })
      const [width, height] = window.getSize()
      const { x, y } = quickChatPosition(tray, workArea, { width, height })
      window.setPosition(x, y)
      window.show()
      window.focus()
    },
  }
}
