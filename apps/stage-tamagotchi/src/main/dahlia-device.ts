// Dahlia: tells the windows the PC's host name, the name Dahlia's other devices see for this PC unless one is
// set in Settings > Dahlia (stage-ui libs/dahlia-device-name.ts). This file is Dahlia's (AIRI has no such
// file); scripts/apply_avatar_branding.sh calls setupDahliaDevice() when the main process starts.
import os from 'node:os'

import { ipcMain } from 'electron'

export const DAHLIA_HOST_NAME_CHANNEL = 'dahlia:host-name'

export function setupDahliaDevice() {
  ipcMain.handle(DAHLIA_HOST_NAME_CHANNEL, () => os.hostname())
}
