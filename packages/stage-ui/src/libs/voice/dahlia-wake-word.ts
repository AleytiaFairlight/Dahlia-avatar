// Dahlia: her wake word. Saying her name starts a voice input in the apps. This file is Dahlia's (AIRI
// has no such file); scripts/apply_avatar_branding.sh puts it on the built-in character card.

import type { WakeWord } from './wake-words'

import { kwsModel } from './kws-model-info'

/**
 * "Dahlia" in the phonemes of the wake word model (CMU dictionary notation), the ways people say it:
 * DAL-yuh, DAH-lyuh, DAY-lee-uh and DAH-lee-uh.
 */
export const dahliaWakeWords: WakeWord[] = [{
  text: 'Dahlia',
  modelId: kwsModel.id,
  pronunciations: [
    ['D', 'AE1', 'L', 'Y', 'AH0'],
    ['D', 'AA1', 'L', 'Y', 'AH0'],
    ['D', 'EY1', 'L', 'IY0', 'AH0'],
    ['D', 'AA1', 'L', 'IY0', 'AH0'],
  ],
}]
