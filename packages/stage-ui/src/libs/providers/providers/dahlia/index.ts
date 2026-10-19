// Dahlia: the apps use only Dahlia's own server (SERVER_URL, https://dahlia.aleytia.moe), so this is
// the one AI provider they offer. It authenticates with the owner's Dahlia key, because Dahlia's server
// has no accounts. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh makes the provider registry load only this module.

import type { ChatRequestOptions, GenerationRequest } from '@proj-airi/provider-inference'

import { compatibleProtocols } from '@proj-airi/provider-inference'
import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

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
        return {
          protocol: 'chat-completions',
          config: provider.chat(model),
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

// AIRI's official providers sign in to AIRI's server, which Dahlia's server does not offer. They stay
// registered under their ids, because other modules import them, but no list shows them.
for (const definition of [providerOfficialChat, providerOfficialSpeech, providerOfficialSpeechStreaming, providerOfficialTranscription])
  defineProvider({ ...(definition as Parameters<typeof defineProvider>[0]), isAvailableBy: () => false })
