// Dahlia: AIRI's provider catalog, for AIRI's tests of the shared provider, speech and settings machinery, which
// pick AIRI's providers (openai, microsoft-speech, kokoro-local, ...). The apps register only Dahlia's providers
// (index.ts); only tests import this file. It registers what AIRI's own index.ts does, except what index.ts already
// registered (Dahlia's, Sherpaw, "no speech" and the official ones). This file is Dahlia's (AIRI has no such file).
import { portableProviderDefinitions } from '@proj-airi/provider-inference'

import { isProviderId, registerProviders } from './registry'

import './index'
import './aliyun-nls'
import './apple-speech'
import './apple-vision'
import './local-audio'
import './kokoro-local'
import './nvidia'
import './prompt-api'

registerProviders(portableProviderDefinitions.filter(definition => !isProviderId(definition.id)))
