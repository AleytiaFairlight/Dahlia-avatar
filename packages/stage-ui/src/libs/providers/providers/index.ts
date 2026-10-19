// Dahlia: the apps talk only to Dahlia's server, so the registry loads only Dahlia's provider
// (./dahlia). AIRI's catalog of third-party providers is not registered.
// scripts/apply_avatar_branding.sh writes this file again after every AIRI update.
import { portableProviderDefinitions } from '@proj-airi/provider-inference'

import { registerProviders } from './registry'

import './dahlia'

// "No speech" is a provider as well, and the speech settings fall back to it.
registerProviders(portableProviderDefinitions.filter(definition => definition.id === 'speech-noop'))

export {
  OFFICIAL_TRANSCRIPTION_PROVIDER_ID,
} from './official'

export {
  getDefinedProvider,
  isProviderId,
  listProviders,
} from './registry'

export type { StageProviderId } from './registry'
