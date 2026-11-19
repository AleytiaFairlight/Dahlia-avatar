// Dahlia: her ghost cursor. When she backseats (her point_on_screen tool, src/renderer/dahlia-remote-tools.ts), a
// translucent pointer with a few words of hers appears on the person's screen where she points, for a few seconds.
// It is a small window that the mouse goes through and that never takes the focus, so the game keeps it. After the
// ghost cursor of dasilva333/airi's arcade, which shows where she would play; hers only points, nothing is clicked.
// This file is Dahlia's (AIRI has no such file); dahlia-window-helper.ts sets it up.

import { BrowserWindow, ipcMain, screen } from 'electron'
import { isWindows } from 'std-env'

export const DAHLIA_GHOST_CURSOR_CHANNEL = 'dahlia:ghost-cursor'
const WIDTH = 280
const HEIGHT = 96
/** The pointer's tip, inside the window. */
const TIP = { x: 6, y: 6 }
const MIN_MS = 1500
const MAX_MS = 15_000
const MAX_LABEL = 80

export interface DahliaGhostCursorRequest {
  /** Where she points, in physical screen pixels (the window helper's coordinates). */
  x: number
  y: number
  label?: string
  ms?: number
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[char]!)
}

/** The page of the cursor: an arrow with a soft pulse at its tip, and her words beside it. */
export function ghostCursorPage(label: string) {
  const words = label ? `<div class="label">${escapeHtml(label)}</div>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font:13px system-ui,-apple-system,"Segoe UI",sans-serif}
.pulse{position:absolute;left:${TIP.x - 14}px;top:${TIP.y - 14}px;width:28px;height:28px;border-radius:50%;background:rgba(236,72,153,.35);animation:pulse 1.2s ease-out infinite}
@keyframes pulse{from{transform:scale(.4);opacity:1}to{transform:scale(1.6);opacity:0}}
svg{position:absolute;left:${TIP.x}px;top:${TIP.y}px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
.label{position:absolute;left:30px;top:26px;max-width:${WIDTH - 40}px;padding:5px 9px;border-radius:10px;background:rgba(236,72,153,.92);color:#fff;line-height:1.3;box-shadow:0 2px 8px rgba(0,0,0,.35)}
</style></head><body><div class="pulse"></div><svg width="26" height="32" viewBox="0 0 26 32"><path d="M1 1 L1 25 L7.5 19 L12 30 L16.5 28 L12 17.5 L21 17.5 Z" fill="rgba(236,72,153,.85)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>${words}</body></html>`
}

/** Shows the cursor where she points, for a while; a new point moves it. */
export function setupDahliaGhostCursor() {
  let window: BrowserWindow | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  function ensureWindow() {
    if (window && !window.isDestroyed())
      return window
    window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setIgnoreMouseEvents(true)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    return window
  }

  ipcMain.handle(DAHLIA_GHOST_CURSOR_CHANNEL, async (_event, request: DahliaGhostCursorRequest) => {
    if (!request || !Number.isFinite(request.x) || !Number.isFinite(request.y))
      return { ok: false, error: 'Send the point as {x, y}.' }
    const label = typeof request.label === 'string' ? request.label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL) : ''
    const ms = Math.min(MAX_MS, Math.max(MIN_MS, Number.isFinite(request.ms) ? request.ms! : 6000))
    // The helper measures in physical pixels; windows are placed in Electron's device-independent pixels.
    const point = isWindows ? screen.screenToDipPoint({ x: request.x, y: request.y }) : { x: request.x, y: request.y }

    const cursor = ensureWindow()
    await cursor.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ghostCursorPage(label))}`)
    cursor.setBounds({ x: Math.round(point.x - TIP.x), y: Math.round(point.y - TIP.y), width: WIDTH, height: HEIGHT })
    cursor.showInactive()
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => cursor.isDestroyed() || cursor.hide(), ms)
    return { ok: true }
  })
}
