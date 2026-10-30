// Dahlia: the app stays locked until the voice check passes. It opens in the main window when this PC needs it
// (no key, no session, a voice print from digits alone); the other windows (settings, chat, the dashboard, the
// spotlight menu…) show a lock screen meanwhile, with a button that opens the check there. Overlays that only show
// things on the desktop (captions, widgets) stay as they are, and so does the first-run setup, which asks for the
// key. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh calls it when the renderer starts.
import type { Pinia } from 'pinia'

import { mountDahliaVoiceCheck } from '@proj-airi/stage-ui/components/scenarios/dialogs/dahlia-voice-check/mount'

import { resolveInitialRendererRoutePath } from './window-context'

/** Windows without a lock: overlays that only show things over the desktop, and the first-run setup. */
const UNLOCKED_ROUTES = ['/caption', '/desktop-overlay', '/widgets', '/inlay', '/beat-sync', '/notice', '/onboarding']

export function startDahliaVoiceCheck(pinia: Pinia) {
  const route = resolveInitialRendererRoutePath('/')
  if (route === '/')
    mountDahliaVoiceCheck(pinia)
  else if (!UNLOCKED_ROUTES.some(unlocked => route === unlocked || route.startsWith(`${unlocked}/`)))
    mountDahliaVoiceCheck(pinia, { auto: false })
}
