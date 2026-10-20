// Dahlia: a character always chats through Dahlia's server once the Dahlia key is set. This file is
// Dahlia's (AIRI has no such file); scripts/apply_avatar_branding.sh calls it where the card store
// resolves a character's modules.

import { DAHLIA_CHAT_PROVIDER_ID, DAHLIA_MODEL_ID } from '../libs/providers/providers/dahlia'
import { useProviderConfigStore } from './providers/config'

export interface ChatSelection {
  provider: string
  model: string
}

/**
 * Returns the chat provider and model a character uses.
 *
 * Dahlia's build has one chat provider, so any other choice is stale: empty, or from an older
 * version. The desktop app could also save empty character defaults, because its onboarding window
 * sets the choice while the main window applies the character, and the main window could apply it
 * before the choice arrived. Once the Dahlia key is set, all of these resolve to Dahlia's server.
 */
export function withDahliaChat(selection: ChatSelection): ChatSelection {
  if (selection.provider === DAHLIA_CHAT_PROVIDER_ID && selection.model)
    return selection
  if (!useProviderConfigStore().getProviderConfig(DAHLIA_CHAT_PROVIDER_ID)?.apiKey)
    return selection
  return { provider: DAHLIA_CHAT_PROVIDER_ID, model: DAHLIA_MODEL_ID }
}
