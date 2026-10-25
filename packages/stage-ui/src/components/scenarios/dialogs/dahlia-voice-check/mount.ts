// Dahlia: puts the voice check in an app window, beside the app (its own root), so it opens over whatever
// page is showing. This file is Dahlia's (AIRI has no such file); the apps' main.ts call it after mounting.
import type { Pinia } from 'pinia'
import type { App } from 'vue'

import { setActivePinia } from 'pinia'
import { createApp } from 'vue'

import DahliaVoiceCheckHost from './dahlia-voice-check-host.vue'

export { default as DahliaVoiceCheckDialog } from './dahlia-voice-check-dialog.vue'

export function mountDahliaVoiceCheck(pinia: Pinia) {
  const root = document.createElement('div')
  root.id = 'dahlia-voice-check'
  document.body.appendChild(root)
  // The stores come from the app's Pinia as the active one. Installing it in this root too (app.use) would make
  // Pinia run the stores it creates later in this root's context, without the app's router and plugins. This
  // root gets the app's provides instead (Pinia's, the router's, i18n's), from the app Pinia was installed in.
  setActivePinia(pinia)
  const host = createApp(DahliaVoiceCheckHost)
  const provides = (pinia as Pinia & { _a?: App })._a?._context.provides ?? {}
  for (const key of Reflect.ownKeys(provides))
    host.provide(key as symbol, (provides as Record<symbol, unknown>)[key as symbol])
  host.mount(root)
}
