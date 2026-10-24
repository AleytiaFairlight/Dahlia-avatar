// Dahlia: puts the voice check in an app window, beside the app (its own root, with the app's Pinia), so
// it opens over whatever page is showing. This file is Dahlia's (AIRI has no such file); the apps' main.ts
// call it after mounting.
import type { Pinia } from 'pinia'

import { createApp } from 'vue'

import DahliaVoiceCheckHost from './dahlia-voice-check-host.vue'

export { default as DahliaVoiceCheckDialog } from './dahlia-voice-check-dialog.vue'

export function mountDahliaVoiceCheck(pinia: Pinia) {
  const root = document.createElement('div')
  root.id = 'dahlia-voice-check'
  document.body.appendChild(root)
  createApp(DahliaVoiceCheckHost).use(pinia).mount(root)
}
