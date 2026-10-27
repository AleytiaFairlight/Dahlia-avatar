// Dahlia: the apps use only Dahlia's own server (SERVER_URL, https://dahlia.aleytia.moe), so these are
// the one chat provider and the one voice they offer. They authenticate with the device's voice-checked
// session for the Dahlia key (stores/dahlia-auth.ts). This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh makes the provider registry load only this module.

import type { ChatRequestOptions, GenerationRequest } from '@proj-airi/provider-inference'

import { compatibleProtocols } from '@proj-airi/provider-inference'
import { createOpenAI } from '@xsai-ext/providers/create'
import { getActivePinia } from 'pinia'
import { z } from 'zod'

import { dahliaBearer } from '../../../../stores/dahlia-auth'
import { useProviderConfigStore } from '../../../../stores/providers/config'
import { SERVER_URL } from '../../../server'
import {
  providerOfficialChat,
  providerOfficialSpeech,
  providerOfficialSpeechStreaming,
  providerOfficialTranscription,
} from '../official'
import { OFFICIAL_ICON } from '../official/shared'
import { defineProvider } from '../registry'

export const DAHLIA_CHAT_PROVIDER_ID = 'dahlia'

/** The only model name Dahlia's server takes. It answers with the model the Discord AI agent uses. */
export const DAHLIA_MODEL_ID = 'auto'

export const DAHLIA_SPEECH_PROVIDER_ID = 'dahlia-speech'

/** Dahlia's voice is the speech provider's only model and only voice. */
export const DAHLIA_VOICE_ID = 'dahlia'

const dahliaChatConfigSchema = z.object({
  apiKey: z.string('Dahlia key'),
})

type DahliaChatConfig = z.input<typeof dahliaChatConfigSchema>

export const providerDahliaChat = defineProvider<DahliaChatConfig, typeof DAHLIA_CHAT_PROVIDER_ID>({
  id: DAHLIA_CHAT_PROVIDER_ID,
  order: -1,
  name: 'Dahlia',
  nameLocalize: () => 'Dahlia',
  description: 'Chat through Dahlia\'s server, with the model Dahlia uses on Discord.',
  descriptionLocalize: () => 'Chat through Dahlia\'s server, with the model Dahlia uses on Discord.',
  tasks: ['text-generation'],
  icon: OFFICIAL_ICON,
  requiresCredentials: true,
  capabilities: { chat: { generation: compatibleProtocols } },

  onboardingFields: () => [
    {
      key: 'apiKey',
      type: 'password' as const,
      label: 'Dahlia key',
      description: 'The key of your Dahlia server. Only people with the key can chat through it.',
      placeholder: 'Dahlia key',
      required: true,
    },
  ],

  createProviderConfig: () => dahliaChatConfigSchema.extend({
    apiKey: dahliaChatConfigSchema.shape.apiKey.meta({
      type: 'password',
      labelLocalized: 'Dahlia key',
      descriptionLocalized: 'The key of your Dahlia server. Only people with the key can chat through it.',
      placeholderLocalized: 'Dahlia key',
    }),
  }),

  createProvider(config) {
    const provider = createOpenAI(config.apiKey, `${SERVER_URL}/api/v1/openai/`)
    return {
      model: provider.model,
      generation(model: string, _options?: ChatRequestOptions): GenerationRequest {
        // Each request sends this device's voice-checked session (stores/dahlia-auth.ts), not the key.
        return {
          protocol: 'chat-completions',
          config: createOpenAI(dahliaBearer() || config.apiKey, `${SERVER_URL}/api/v1/openai/`).chat(model),
        }
      },
    }
  },

  validationRequiredWhen: () => false,

  extraMethods: {
    listModels: async () => [
      {
        id: DAHLIA_MODEL_ID,
        name: 'Dahlia',
        provider: DAHLIA_CHAT_PROVIDER_ID,
        description: 'The model Dahlia uses on Discord',
      },
    ],
  },
})

/** The Dahlia key, as saved for the chat provider during setup. One key opens Dahlia's server. */
function dahliaKey(): string {
  if (!getActivePinia())
    return ''
  const apiKey = useProviderConfigStore().getProviderConfig(DAHLIA_CHAT_PROVIDER_ID)?.apiKey
  return typeof apiKey === 'string' ? apiKey : ''
}

export const providerDahliaSpeech = defineProvider({
  id: DAHLIA_SPEECH_PROVIDER_ID,
  order: -1,
  name: 'Dahlia\'s voice',
  nameLocalize: () => 'Dahlia\'s voice',
  description: 'Dahlia speaks in her own voice, from Dahlia\'s server.',
  descriptionLocalize: () => 'Dahlia speaks in her own voice, from Dahlia\'s server.',
  tasks: ['text-to-speech'],
  icon: OFFICIAL_ICON,
  // It uses the chat provider's Dahlia key, read for each request so a changed key applies at once.
  requiresCredentials: false,

  createProviderConfig: () => z.object({}),
  createProvider() {
    return {
      speech: (model: string, extraOptions?: Record<string, unknown>) => ({
        ...createOpenAI(dahliaBearer() || dahliaKey(), `${SERVER_URL}/api/v1/openai/`).speech(model),
        ...extraOptions,
      }),
    }
  },

  validationRequiredWhen: () => false,

  extraMethods: {
    listModels: async () => [
      {
        id: DAHLIA_VOICE_ID,
        name: 'Dahlia',
        provider: DAHLIA_SPEECH_PROVIDER_ID,
        description: 'Dahlia\'s own voice',
      },
    ],
    voiceCatalogConfig: () => ({}),
    listVoices: async () => [
      {
        id: DAHLIA_VOICE_ID,
        name: 'Dahlia',
        provider: DAHLIA_SPEECH_PROVIDER_ID,
        languages: [{ code: 'en', title: 'English' }],
      },
    ],
  },
})

// AIRI's official providers sign in to AIRI's server, which Dahlia's server does not offer. They stay
// registered under their ids, because other modules import them, but no list shows them.
for (const definition of [providerOfficialChat, providerOfficialSpeech, providerOfficialSpeechStreaming, providerOfficialTranscription])
  defineProvider({ ...(definition as Parameters<typeof defineProvider>[0]), isAvailableBy: () => false })
