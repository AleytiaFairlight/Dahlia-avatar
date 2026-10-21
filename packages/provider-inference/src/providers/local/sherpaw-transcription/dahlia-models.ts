// Dahlia: the English speech model of the Dahlia apps. Sherpaw's models are bilingual Chinese and English
// or multilingual, and turned some English speech into Chinese, so the apps transcribe English only.
// This file is Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh adds the model to
// models.ts and makes both apps bundle it. avatar/scripts/dahlia-sherpaw-pack.mjs builds its pack from
// sherpa-onnx's release before the apps are built: the model is not on Sherpaw's hub.

import type { SherpawModel } from './models'

/**
 * sherpa-onnx's streaming Zipformer for English (2023-06-26; encoder and joiner INT8). On English test
 * speech it made 3 errors in 102 words where the bilingual Paraformer made 21, at 8 times real time.
 */
export const zipformerEnglishInt8 = {
  id: 'zipformer-en-2023-06-26-int8',
  name: 'Zipformer English (INT8)',
  repository: 'k2-fsa/sherpa-onnx-streaming-zipformer-en-2023-06-26',
  // The pack is built, not downloaded; the revision names the build.
  revision: 'dahlia-1',
  supportedLanguages: ['en'],
  recognizer: 'transducer',
  modelingUnit: '',
  directory: 'wasm',
} as const satisfies SherpawModel

const CAPITALIZED_WORDS: Record<string, string> = {
  'i': 'I',
  'i\'m': 'I\'m',
  'i\'ll': 'I\'ll',
  'i\'ve': 'I\'ve',
  'i\'d': 'I\'d',
  'dahlia': 'Dahlia',
}

/**
 * The English model writes in capitals. Its text becomes sentence case: the first letter, "I" and
 * her name capitalized. Text of other models stays as it is.
 */
export function dahliaTranscriptText(model: { id: string }, text: string): string {
  if (model.id !== zipformerEnglishInt8.id || text !== text.toUpperCase())
    return text

  const words = text.toLowerCase().replace(/[a-z']+/g, word => CAPITALIZED_WORDS[word] ?? word)
  return words.replace(/^(\s*)([a-z])/, (_, space: string, letter: string) => space + letter.toUpperCase())
}
