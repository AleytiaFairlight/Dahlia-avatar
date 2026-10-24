// Dahlia: puts the voice check in an app window, beside the app (its own root), so it opens over whatever
// page is showing. This file is Dahlia's (AIRI has no such file); the apps' main.ts call it after mounting.
import type { Pinia } from 'pinia'

import { setActivePinia } from 'pinia'
import { createApp } from 'vue'

import DahliaVoiceCheckHost from './dahlia-voice-check-host.vue'

export { default as DahliaVoiceCheckDialog } from './dahlia-voice-check-dialog.vue'

export function mountDahliaVoiceCheck(pinia: Pinia) {
  const root = document.createElement('div')
  root.id = 'dahlia-voice-check'
  document.body.appendChild(root)
  // The stores come from the app's Pinia as the active one. Installing it in this root too (app.use) would make
  // Pinia run the stores it creates later in this root's context, without the app's router and plugins.
  setActivePinia(pinia)
  createApp(DahliaVoiceCheckHost).mount(root)
}
