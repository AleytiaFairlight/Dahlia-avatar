import type { ChatToolReference } from '@proj-airi/stage-ui/types/chat'

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { artistryToolReferences, computerUseToolReferences } from './built-in'

/**
 * The tools that the user grants to new chat turns.
 *
 * The chat window composer owns the control. Turns from other sources read the same choice: the main window sends
 * spoken turns with {@link requestTools}, so a wake word reaches the same tools as typed text.
 *
 * Replicated rather than persisted. The control is in the chat window and spoken turns start in the main window,
 * so the value has to cross windows. A restart returns to the default, as the composer did before.
 */
export const useToolSelectionStore = defineStore('tamagotchi-tool-selection', () => {
  // Dahlia: off by default. She drives this PC with her own device tools (the screenshot, tap and game
  // tools of dahlia-remote-tools.ts, always offered), so AIRI's stage computer-use would only compete with
  // them -- when both are offered she reaches for computer_use, which can't read or click her game window,
  // instead of her tap. The composer toggle below still turns it on for anyone who wants it.
  const computerUseEnabled = ref(false)

  /** Tool references of a new turn. Retries and tool reruns build their own lists from {@link computerUseEnabled}. */
  const requestTools = computed<ChatToolReference[]>(() => computerUseEnabled.value
    ? [...artistryToolReferences, ...computerUseToolReferences]
    : artistryToolReferences)

  return { computerUseEnabled, requestTools }
}, {
  synced: {
    state: true,
  },
})
