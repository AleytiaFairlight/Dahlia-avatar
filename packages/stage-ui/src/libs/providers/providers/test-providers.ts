// Dahlia: providers for the tests of the shared provider, speech, hearing, vision and settings machinery. The apps
// register only Dahlia's providers (./index); AIRI's catalog of third-party providers is deleted. These stand-ins
// talk the OpenAI-compatible protocol to whatever `fetch` a test supplies. Only tests import this file.
import type { ProviderModelCatalog } from '@proj-airi/provider-inference'

import { compatibleProtocols, createOpenAICompatibleValidators, ProviderValidationCheck } from '@proj-airi/provider-inference'
import { createOpenAI } from '@xsai-ext/providers/create'
import { listModels } from '@xsai/model'
import { z } from 'zod'

import { defineProvider } from './registry'

import './index'

const TEST_BASE_URL = 'https://provider.test/v1/'

const chatConfigSchema = z.object({
  api: z.enum(compatibleProtocols.supportedProtocols).default(compatibleProtocols.defaultProtocol),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional().default(TEST_BASE_URL),
})

const audioConfigSchema = z.object({
  apiKey: z.string(),
  baseUrl: z.string().default(TEST_BASE_URL),
  region: z.string().optional(),
})

type ChatConfig = z.input<typeof chatConfigSchema>
type AudioConfig = z.input<typeof audioConfigSchema>

function normalizeBaseUrl(baseUrl: string | undefined) {
  const value = baseUrl?.trim() ?? ''
  return value && !value.endsWith('/') ? `${value}/` : value
}

function audioConfigValidator(config: AudioConfig) {
  const errors: Array<{ error: unknown }> = []
  if (!config.apiKey?.trim())
    errors.push({ error: new Error('API Key is required') })
  if (!config.baseUrl?.trim())
    errors.push({ error: new Error('Base URL is required.') })
  return { errors, reason: errors.map(item => (item.error as Error).message).join(', '), reasonKey: '', valid: errors.length === 0 }
}

function defineTestChatProvider<const TId extends string>(id: TId, name: string) {
  return defineProvider<ChatConfig, TId>({
    id,
    name,
    nameLocalize: () => name,
    description: `${name} for tests`,
    descriptionLocalize: () => `${name} for tests`,
    tasks: ['chat'],
    capabilities: { chat: { generation: compatibleProtocols, reasoning: { modes: ['enabled', 'disabled'] } } },
    createProviderConfig: () => chatConfigSchema,
    createProvider(config) {
      const provider = createOpenAI(config.apiKey ?? '', config.baseUrl)
      return {
        model: provider.model,
        generation(model, options) {
          const request = { ...provider.chat(model), ...(options?.reasoning ? { reasoning: { effort: options.reasoning === 'disabled' ? 'none' : 'medium' } } : {}) }
          return (config.api ?? compatibleProtocols.defaultProtocol) === 'responses'
            ? { protocol: 'responses', config: request, webSearch: false }
            : { protocol: 'chat-completions', config: request }
        },
      }
    },
    validationRequiredWhen: config => !!config.apiKey?.trim(),
    validators: {
      ...createOpenAICompatibleValidators({
        checks: [ProviderValidationCheck.Connectivity, ProviderValidationCheck.ModelList, ProviderValidationCheck.ChatCompletions],
      }),
    },
  })
}

/** A chat provider like any OpenAI-compatible endpoint: its models come from `GET models`. */
export const testChatProvider = defineTestChatProvider('test-chat', 'Test chat')
/** A second chat provider, for switching between providers. */
export const testOtherChatProvider = defineTestChatProvider('test-other-chat', 'Other test chat')

/** A speech provider with a server-side voice catalog at `GET voices` and one model, `v1`. */
export const testSpeechProvider = defineProvider<AudioConfig, 'test-speech'>({
  id: 'test-speech',
  name: 'Test speech',
  nameLocalize: () => 'Test speech',
  description: 'Speech for tests',
  descriptionLocalize: () => 'Speech for tests',
  tasks: ['text-to-speech'],
  createProviderConfig: () => audioConfigSchema,
  createProvider: config => createOpenAI(config.apiKey.trim(), normalizeBaseUrl(config.baseUrl)),
  validationRequiredWhen: config => Boolean(config.apiKey?.trim() && config.baseUrl?.trim()),
  validators: {
    validateConfig: [() => ({ id: 'test-speech:check-config', name: 'Check config', validator: async (config: AudioConfig) => audioConfigValidator(config) })],
  },
  extraMethods: {
    listModels: async () => [{ id: 'v1', name: 'v1', provider: 'test-speech', description: '', deprecated: false }],
    voiceCatalogConfig: ({ apiKey, baseUrl, region }) => ({ apiKey, baseUrl, region }),
    listVoices: async (config) => {
      const response = await fetch(new URL('voices', normalizeBaseUrl(config.baseUrl) || TEST_BASE_URL), {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      })
      if (!response.ok)
        throw new Error(`Voice catalog request failed: ${response.status}`)
      const body = await response.json() as { voices?: Array<{ id: string, name: string, languages?: Array<{ code: string, title: string }>, preview_audio_url?: string, labels?: { gender?: string } }> }
      return (body.voices ?? []).map(voice => ({
        id: voice.id,
        name: voice.name,
        provider: 'test-speech',
        previewURL: voice.preview_audio_url,
        languages: voice.languages ?? [],
        gender: voice.labels?.gender,
      }))
    },
  },
})

/** A speech provider whose model and voice come from its configuration, like a self-hosted OpenAI-compatible server. */
export const testConfiguredSpeechProvider = defineProvider<AudioConfig, 'test-configured-speech'>({
  id: 'test-configured-speech',
  name: 'Configured test speech',
  nameLocalize: () => 'Configured test speech',
  description: 'Speech for tests, configured by hand',
  descriptionLocalize: () => 'Speech for tests, configured by hand',
  tasks: ['text-to-speech'],
  createProviderConfig: () => audioConfigSchema.extend({ baseUrl: z.string().default('') }),
  createProvider: config => createOpenAI(config.apiKey.trim(), normalizeBaseUrl(config.baseUrl)),
  validationRequiredWhen: config => Boolean(config.apiKey?.trim() && config.baseUrl?.trim()),
  validators: {
    validateConfig: [() => ({ id: 'test-configured-speech:check-config', name: 'Check config', validator: async (config: AudioConfig) => audioConfigValidator(config) })],
  },
  extraMethods: {
    voiceCatalogConfig: () => ({}),
    listVoices: async () => [],
    listModels: async (config) => {
      const apiKey = config.apiKey?.trim() ?? ''
      const baseUrl = normalizeBaseUrl(config.baseUrl)
      if (!apiKey || !baseUrl)
        return []
      const models = await listModels({ apiKey, baseURL: baseUrl })
      return models
        .filter(model => model.id.toLowerCase().includes('tts'))
        .map(model => ({ id: model.id, name: model.id, provider: 'test-configured-speech', description: '', contextLength: 0, deprecated: false }))
    },
  },
})

/** A transcription provider like any OpenAI-compatible endpoint. Its models are not listed. */
export const testTranscriptionProvider = defineProvider<AudioConfig, 'test-transcription'>({
  id: 'test-transcription',
  name: 'Test transcription',
  nameLocalize: () => 'Test transcription',
  description: 'Transcription for tests',
  descriptionLocalize: () => 'Transcription for tests',
  tasks: ['speech-to-text', 'automatic-speech-recognition', 'asr', 'stt'],
  capabilities: {
    transcription: { protocol: 'http', generateOutput: true, streamOutput: false, streamInput: false },
  },
  createProviderConfig: () => audioConfigSchema.extend({ baseUrl: z.string().default('') }),
  createProvider(config) {
    const provider = createOpenAI(config.apiKey.trim(), normalizeBaseUrl(config.baseUrl))
    const transcription = provider.transcription.bind(provider)
    provider.transcription = (model: string, extraOptions?: Record<string, unknown>) => ({ ...transcription(model), ...extraOptions })
    return provider
  },
  validationRequiredWhen: config => Boolean(config.apiKey?.trim() && config.baseUrl?.trim()),
  validators: {
    validateConfig: [() => ({ id: 'test-transcription:check-config', name: 'Check config', validator: async (config: AudioConfig) => audioConfigValidator(config) })],
  },
  extraMethods: { listModels: async () => [] },
})

/** A vision provider with one fixed model, `system`, that needs no key. */
export const testVisionProvider = defineProvider<Record<string, never>, 'test-vision'>({
  id: 'test-vision',
  name: 'Test vision',
  nameLocalize: () => 'Test vision',
  description: 'Vision for tests',
  descriptionLocalize: () => 'Vision for tests',
  tasks: ['vision', 'image-understanding'],
  requiresCredentials: false,
  capabilities: { vision: { concurrentReads: 1 } },
  createProviderConfig: () => z.object({}),
  createProvider: () => {
    const provider = createOpenAI('', TEST_BASE_URL)
    return { generation: model => ({ protocol: 'chat-completions', config: provider.chat(model) }) }
  },
  extraMethods: {
    listModelCatalog: async (): Promise<ProviderModelCatalog> => ({
      models: [{ id: 'system', name: 'System model', provider: 'test-vision', description: '' }],
      defaultModel: 'system',
    }),
  },
})

/** A speech provider that runs on the device and needs no key, with model `fp32` and voice `af_heart`. */
export const testLocalSpeechProvider = defineProvider<Record<string, never>, 'test-local-speech'>({
  id: 'test-local-speech',
  name: 'Local test speech',
  nameLocalize: () => 'Local test speech',
  description: 'Speech on the device, for tests',
  descriptionLocalize: () => 'Speech on the device, for tests',
  tasks: ['text-to-speech'],
  requiresCredentials: false,
  createProviderConfig: () => z.object({}),
  createProvider: () => createOpenAI('', 'http://local-speech.test/v1/'),
  extraMethods: {
    listModels: async () => [{ id: 'fp32', name: 'fp32', provider: 'test-local-speech', description: '', deprecated: false }],
    voiceCatalogConfig: () => ({}),
    listVoices: async () => [{ id: 'af_heart', name: 'Heart', provider: 'test-local-speech', languages: [] }],
  },
})
