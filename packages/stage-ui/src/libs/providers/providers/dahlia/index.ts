// Dahlia: the apps use only Dahlia's own server (SERVER_URL, https://dahlia.aleytia.moe), so this is
// the one AI provider they offer. It authenticates with the device's voice-checked session for the
// Dahlia key (stores/dahlia-auth.ts). This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh makes the provider registry load only this module.

import type { ChatRequestOptions, GenerationRequest } from '@proj-airi/provider-inference'

import { compatibleProtocols } from '@proj-airi/provider-inference'
import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { dahliaBearer } from '../../../../stores/dahlia-auth'
import { SERVER_URL } from '../../../server'
import { defineProvider } from '../registry'

export const DAHLIA_CHAT_PROVIDER_ID = 'dahlia'

/** The only model name Dahlia's server takes. It answers with the model the Discord AI agent uses. */
export const DAHLIA_MODEL_ID = 'auto'

/** The icon of Dahlia's provider. */
const DAHLIA_PROVIDER_ICON = 'i-solar:star-bold-duotone'

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
  icon: DAHLIA_PROVIDER_ICON,
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
