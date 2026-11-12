// Dahlia: what this PC knows about what its person is doing, for her PC awareness (stage-ui
// libs/dahlia-pc-awareness.ts, run by src/renderer/dahlia-pc-awareness.ts): the window in front and its program
// (the window helper, Windows only), how long the keyboard and mouse have been still, and how full the processor
// and the memory are. The renderer asks on the "dahlia:pc-state" channel; nothing is collected until it does.
// This file is Dahlia's (AIRI has no such file); dahlia-window-helper.ts sets it up.

import type { DahliaWindowAnswer } from './dahlia-window-helper'

import { cpus, freemem, totalmem } from 'node:os'

import { BrowserWindow, ipcMain, powerMonitor } from 'electron'

export const DAHLIA_PC_STATE_CHANNEL = 'dahlia:pc-state'

export interface DahliaPcState {
  app: string
  title: string
  /** One of Dahlia's own windows has the keyboard. */
  own: boolean
  idleSeconds: number
  cpu?: number
  memory: number
}

export interface DahliaPcStateDeps {
  foreground: () => Promise<DahliaWindowAnswer>
  idleSeconds: () => number
  ownFocused: () => boolean
  /** Each processor's times, as node:os gives them. */
  cpuTimes: () => Array<{ user: number, nice: number, sys: number, idle: number, irq: number }>
  freeMemory: () => number
  totalMemory: () => number
}

/** Answers with the PC's state; the processor's share is measured between two answers. */
export function createDahliaPcState(deps: DahliaPcStateDeps) {
  let before: { busy: number, total: number } | undefined

  function cpu() {
    let busy = 0
    let total = 0
    for (const times of deps.cpuTimes()) {
      busy += times.user + times.nice + times.sys + times.irq
      total += times.user + times.nice + times.sys + times.irq + times.idle
    }
    const last = before
    before = { busy, total }
    if (!last || total <= last.total)
      return undefined
    return Math.round(Math.min(1, Math.max(0, (busy - last.busy) / (total - last.total))) * 100)
  }

  return async (): Promise<DahliaPcState> => {
    // Without the window helper (not Windows, or it failed) the rest is still worth telling.
    const front = await deps.foreground().catch((): DahliaWindowAnswer => ({ ok: false, error: '' }))
    const total = deps.totalMemory()
    return {
      app: front.ok && typeof front.process === 'string' ? front.process : '',
      title: front.ok && typeof front.title === 'string' ? front.title : '',
      own: deps.ownFocused(),
      idleSeconds: Math.max(0, Math.round(deps.idleSeconds())),
      cpu: cpu(),
      memory: total > 0 ? Math.round((1 - deps.freeMemory() / total) * 100) : 0,
    }
  }
}

export function setupDahliaPcState(foreground: () => Promise<DahliaWindowAnswer>) {
  const state = createDahliaPcState({
    foreground,
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    ownFocused: () => BrowserWindow.getFocusedWindow() != null,
    cpuTimes: () => cpus().map(cpu => cpu.times),
    freeMemory: freemem,
    totalMemory: totalmem,
  })
  ipcMain.handle(DAHLIA_PC_STATE_CHANNEL, () => state())
}
