import type { Plugin } from 'vue'
import type { Router, RouteRecordRaw } from 'vue-router'

import Tres from '@tresjs/core'
import NProgress from 'nprogress'

import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { errorMessageFrom } from '@moeru/std'
import { settingsSearchModules } from '@proj-airi/stage-pages/settings-search'
import { isEnvTruthy } from '@proj-airi/stage-shared'
import { mountDahliaVoiceCheck } from '@proj-airi/stage-ui/components/scenarios/dialogs/dahlia-voice-check/mount'
import { trackButtonPlugin } from '@proj-airi/stage-ui/directives/track-button'
import { startDahliaAnimationLibrary } from '@proj-airi/stage-ui/libs/dahlia-animation-library'
import { startDahliaErrorReports } from '@proj-airi/stage-ui/libs/dahlia-error-reports'
import { startDahliaSpokenHighlight } from '@proj-airi/stage-ui/libs/dahlia-spoken-highlight'
import { setupSynced } from '@proj-airi/stage-ui/libs/pinia'
import { configureAnalyticsAdapter } from '@proj-airi/stage-ui/libs/product-signals'
import { settingsSearch } from '@proj-airi/stage-ui/libs/settings-search'
import { enableDahliaHearingOnce } from '@proj-airi/stage-ui/stores/dahlia-hearing'
import { startDahliaSettingsSync } from '@proj-airi/stage-ui/stores/dahlia-settings-sync'
import { MotionPlugin } from '@vueuse/motion'
import { createPinia } from 'pinia'
import { setupLayouts } from 'virtual:generated-layouts'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'

import App from './App.vue'

import { installDahliaContentSecurityPolicy } from './dahlia-network'
import { startDahliaPhone } from './dahlia-phone'
import { checkForDahliaUpdate } from './dahlia-updater'
import { i18n } from './modules/i18n'

// Dahlia: without AIRI's two Chinese display fonts (cjkfonts AllSeto, Xiaolai SC, 51 MB): no font stack of the app
// uses them, only stage-ui's stories.
import '@unocss/reset/tailwind.css'
import 'splitpanes/dist/splitpanes.css'
import 'vue-sonner/style.css'
import './styles/main.css'
import 'uno.css'

configureAnalyticsAdapter(async (options) => {
  const { createOpenpanelAdapter } = await import('@proj-airi/stage-ui/libs/product-signals/openpanel')
  return createOpenpanelAdapter(options)
})

if (Capacitor.isNativePlatform()) {
  if (Capacitor.getPlatform() === 'ios') {
    void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch((error) => {
      console.warn('Failed to hide the iOS keyboard accessory bar:', errorMessageFrom(error))
    })
  }
}

// The settings search lists only what these modules hold. Each module decides at runtime whether it is on.
for (const [name, source] of Object.entries(settingsSearchModules))
  settingsSearch.provide(name, source)

// Dahlia: the app connects only to Dahlia's server and to itself.
installDahliaContentSecurityPolicy()

const pinia = createPinia()
const synced = setupSynced()
pinia.use(synced.pinia)

// TODO: vite-plugin-vue-layouts is long deprecated, replace with another layout solution
const routeRecords = setupLayouts(routes as RouteRecordRaw[])

let router: Router
if (isEnvTruthy(import.meta.env.VITE_APP_TARGET_HUGGINGFACE_SPACE))
  router = createRouter({ routes: routeRecords, history: createWebHashHistory() })
else
  router = createRouter({ routes: routeRecords, history: createWebHistory() })

router.beforeEach((to, from) => {
  if (to.path !== from.path)
    NProgress.start()
})

router.afterEach(() => {
  NProgress.done()
})

window.addEventListener('unhandledrejection', (event) => {
  console.warn('Unhandled rejection:', event.reason)
})

const app = createApp(App)
// Dahlia: errors and crashes go to a log on her server (libs/dahlia-error-reports.ts), not to Sentry.
startDahliaErrorReports(app)
startDahliaAnimationLibrary()
startDahliaSpokenHighlight()

app
  .use(synced.vue)
  .use(MotionPlugin)
  // TODO: Fix autoAnimatePlugin type error
  .use(autoAnimatePlugin as unknown as Plugin)
  .use(router)
  .use(pinia)
  .use(i18n)
  .use(Tres)
  .use(trackButtonPlugin)
  .mount('#app')

// Dahlia: the voice check, when this device needs a session.
mountDahliaVoiceCheck(pinia)

// Dahlia: share the preferences with her other apps through her server.
startDahliaSettingsSync()

// Dahlia: listen for her name, once; the Hearing settings decide after that.
void enableDahliaHearingOnce()

// Dahlia: look for a newer release on GitHub, like the desktop app.
void checkForDahliaUpdate()

// Dahlia: her phone features, the assistant button and listening in the background.
void startDahliaPhone()

if (import.meta.env.DEV && !import.meta.env.SSR) {
  function captureEvents(el: HTMLElement) {
    // Force `pointer-events: auto` as DismissableLayer in Reka UI adds
    // `pointer-events: none` to document body.
    el.style.pointerEvents = 'auto'

    // We need to capture events inside elements like devtools to prevent them
    // from leaking to other layers (like DismissableLayer in Reka UI).
    //
    // See: https://github.com/unovue/reka-ui/blob/14866201d179b8bae3c8b4346a1ca8eff1c5eaa4/packages/radix-vue/src/DismissableLayer/DismissableLayer.vue#L186-L188
    el.addEventListener('focus', e => e.stopPropagation(), { capture: true })
    el.addEventListener('blur', e => e.stopPropagation(), { capture: true })
    el.addEventListener('pointerdown', e => e.stopPropagation(), { capture: true })
  }

  const observer = new MutationObserver((mutationsList, observer) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        const devtoolsContainer = document.getElementById('__vue-devtools-container__')

        if (devtoolsContainer) {
          captureEvents(devtoolsContainer)
          observer.disconnect()
        }
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  // Disconnect on timeout in case the MutationObserver is left here forever.
  // `observer.disconnect()` is idempotent, so it's safe to call it multiple times.
  setTimeout(() => observer.disconnect(), 15 * 1000)
}
