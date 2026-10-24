// Dahlia: the voice check opens in the main window when this PC needs a session (Settings > Dahlia has it
// too). This file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls it when the
// renderer starts.
import type { Pinia } from 'pinia'

import { mountDahliaVoiceCheck } from '@proj-airi/stage-ui/components/scenarios/dialogs/dahlia-voice-check/mount'

import { resolveInitialRendererRoutePath } from './window-context'

export function startDahliaVoiceCheck(pinia: Pinia) {
  if (resolveInitialRendererRoutePath('/') === '/')
    mountDahliaVoiceCheck(pinia)
}
