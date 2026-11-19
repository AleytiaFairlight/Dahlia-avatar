import { describe, expect, it, vi } from 'vitest'

import { quickChatPosition } from '.'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), ipcMain: { handle: vi.fn() }, screen: {} }))
vi.mock('../../../../resources/icon.png?asset', () => ({ default: '' }))
vi.mock('../../libs/electron/location', () => ({}))
vi.mock('../../libs/electron/window-context', () => ({}))
vi.mock('../../libs/electron/window-manager', () => ({}))
vi.mock('../shared', () => ({}))
vi.mock('../chat/rpc/index.electron', () => ({}))

describe('dahlia quick chat', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
  const size = { width: 380, height: 560 }

  it('opens above a tray icon on a bottom taskbar, kept on the screen', () => {
    expect(quickChatPosition({ x: 1700, y: 1050, width: 24, height: 24 }, workArea, size)).toEqual({ x: 1522, y: 474 })
    expect(quickChatPosition({ x: 1900, y: 1050, width: 24, height: 24 }, workArea, size).x).toBe(1920 - 380 - 6)
  })

  it('opens below a tray icon on a top menu bar, and beside one on a side taskbar', () => {
    const top = { x: 0, y: 25, width: 1920, height: 1055 }
    expect(quickChatPosition({ x: 1600, y: 0, width: 22, height: 22 }, top, size)).toEqual({ x: 1421, y: 31 })

    const leftOfRightBar = { x: 0, y: 0, width: 1860, height: 1080 }
    const beside = quickChatPosition({ x: 1880, y: 900, width: 24, height: 24 }, leftOfRightBar, size)
    expect(beside.x).toBe(1860 - 380 - 6)
    expect(beside.y).toBe(1080 - 560 - 6)
  })
})
