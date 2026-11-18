import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useProviderStore } from '../providers/provider'
import { speechFieldsKeyOf, speechFieldStatus, toSignedPercent, useSpeechStore } from './speech'

// Dahlia: stand-in providers for the tests; the apps register only Dahlia's.
import '../../libs/providers/providers/test-providers'

const i18nState = vi.hoisted(() => ({
  locale: { value: 'en-US' },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: i18nState.locale,
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('speech store helpers', () => {
  beforeEach(() => {
    i18nState.locale.value = 'en-US'
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('formats positive percentages with a plus sign', () => {
    expect(toSignedPercent(25)).toBe('+25%')
  })

  it('formats negative percentages without a double minus', () => {
    expect(toSignedPercent(-20)).toBe('-20%')
    expect(toSignedPercent(-20)).not.toContain('--')
  })

  it('formats zero as 0%', () => {
    expect(toSignedPercent(0)).toBe('0%')
  })

  // ROOT CAUSE:
  //
  // The speech store watched its model-list projection even when no UI used
  // that projection. Each synced provider snapshot invalidated the projection.
  // The watcher then called getModelsForProvider twice when the cache was empty.
  //
  // We fixed this by keeping model selection behind explicit operations. A UI
  // consumer can still read providerModels when it needs the cached catalog.
  it('does not query the model cache when only provider state changes', async () => {
    const providersStore = useProviderStore()
    vi.spyOn(providersStore, 'listProviderVoices').mockResolvedValue([])
    const speechStore = useSpeechStore()
    speechStore.activeSpeechProvider = 'test-configured-speech'
    await nextTick()

    let modelQueries = 0
    providersStore.$onAction(({ name }) => {
      if (name === 'getModelsForProvider')
        modelQueries += 1
    })

    providersStore.providerRuntimeState = {}
    await nextTick()

    expect(modelQueries).toBe(0)
  })

  // ROOT CAUSE:
  //
  // A synced snapshot replaced the empty voice catalog with another empty
  // object. The voice watcher then assigned undefined to an undefined ref.
  // refManualReset reported that no-op assignment as another Pinia mutation.
  //
  // Catalog refreshes now stay outside the speech settings snapshot. They
  // must not publish settings when no selected voice needs an update.
  it('does not publish a second mutation for an unresolved voice', async () => {
    const providersStore = useProviderStore()
    vi.spyOn(providersStore, 'listProviderVoices').mockResolvedValue([])
    const speechStore = useSpeechStore()
    speechStore.activeSpeechProvider = 'test-configured-speech'
    speechStore.activeSpeechVoiceId = 'missing-voice'
    speechStore.activeSpeechVoice = undefined
    await speechStore.loadVoicesForProvider('test-configured-speech')
    await nextTick()
    // The startup watcher now enters through the deferred public action.
    await vi.waitFor(() => expect(speechStore.isLoadingSpeechProviderVoices).toBe(false))

    let mutations = 0
    speechStore.$subscribe(() => mutations += 1, { flush: 'sync' })

    await speechStore.loadVoicesForProvider('test-configured-speech')
    await nextTick()

    expect(mutations).toBe(0)
  })

  /**
   * @example
   * speechStore.resolveSpeechInput({ text, voice, providerConfig: { voice: 'plain' } })
   */
  it('leaves speech input unchanged by default', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'plain-voice',
      name: 'Plain Voice',
      provider: 'test-configured-speech',
      languages: [{ code: 'en-US', title: 'English' }],
    }

    const request = speechStore.resolveSpeechInput({
      text: 'hello',
      voice,
      providerConfig: { voice: 'plain-voice' },
    })

    expect(request.input).toBe('hello')
    expect(request.providerConfig).toEqual({ voice: 'plain-voice' })
  })

  it('applies configured pitch through SSML when supported', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'voice-1',
      name: 'Voice 1',
      provider: 'test-configured-speech',
      languages: [{ code: 'en-US', title: 'English' }],
      gender: 'neutral',
    }

    const request = speechStore.resolveSpeechInput({
      text: 'hello',
      voice,
      providerConfig: { pitch: 20 },
      forceSSML: true,
      supportsSSML: true,
    })

    expect(request.input).toContain('<prosody')
    expect(request.input).toContain('pitch="+20%"')
  })

  /**
   * @example
   * speechStore.resolveSpeechInput({ text, voice, forceSSML: true, supportsSSML: false })
   */
  it('keeps speech input as plain text for a provider without SSML when global SSML is enabled', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'voice-1',
      name: 'Voice 1',
      provider: 'test-configured-speech',
      languages: [{ code: 'en-US', title: 'English' }],
      gender: 'neutral',
    }

    // A provider that applies prosody through its own options rejects `<speak>...` payloads, so its text stays plain.
    const request = speechStore.resolveSpeechInput({
      text: 'hello',
      voice,
      providerConfig: { pitch: 0 },
      forceSSML: true,
      supportsSSML: false,
    })

    expect(request.input).toBe('hello')
    expect(request.input).not.toContain('<speak')
  })
})

describe('single model speech providers', () => {
  // Selecting a provider makes the speech store load its voices. Without a stub
  // the providers reach for a real server. The rejection then logs after the
  // file finishes, and the run fails on a teardown race.
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', async () => Response.json([]))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // https://github.com/moeru-ai/airi/issues/2166
  it('selects the only published model, so the provider is not left unconfigured — Issue #2166', async () => {
    // `settings/modules/speech.vue` clears `activeSpeechModel` on every provider
    // switch. Without the seeding below, a provider that publishes one model
    // keeps an empty model, `configured` stays false, and the stage never
    // speaks until the user opens the dropdown and picks that one entry.
    const providersStore = useProviderStore()
    const speechStore = useSpeechStore()
    speechStore.activeSpeechProvider = 'test-local-speech'
    speechStore.activeSpeechModel = ''
    await providersStore.initializeProvider('test-local-speech')
    providersStore.providerRuntimeState['test-local-speech'].models = [
      { id: 'default', name: 'Default', provider: 'test-local-speech' },
    ]

    speechStore.ensureActiveSpeechModel()

    expect(speechStore.activeSpeechModel).toBe('default')
  })

  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3967236129
  // ROOT CAUSE: Single-model defaults overwrote explicit names from the manual field.
  it('preserves a manually entered model through selection and catalog loading', async () => {
    const providers = useProviderStore()
    await providers.initializeProvider('test-configured-speech')
    providers.providerRuntimeState['test-configured-speech'].models = [
      { id: 'discovered', name: 'Discovered', provider: 'test-configured-speech' },
    ]
    const speech = useSpeechStore()
    await speech.selectProviderModel('test-configured-speech', 'manual-model')
    await speech.loadVoicesForProvider('test-configured-speech', 'manual-model')
    expect(speech.activeSpeechModel).toBe('manual-model')
  })

  it('keeps the voice when it seeds the model, because voices belong to the provider', async () => {
    const providersStore = useProviderStore()
    const speechStore = useSpeechStore()
    speechStore.activeSpeechProvider = 'test-local-speech'
    speechStore.activeSpeechModel = ''
    speechStore.activeSpeechVoiceId = '3'
    await providersStore.initializeProvider('test-local-speech')
    providersStore.providerRuntimeState['test-local-speech'].models = [
      { id: 'default', name: 'Default', provider: 'test-local-speech' },
    ]

    speechStore.ensureActiveSpeechModel()

    expect(speechStore.activeSpeechVoiceId).toBe('3')
  })

  it('does not guess when a provider publishes several models', async () => {
    const providersStore = useProviderStore()
    const speechStore = useSpeechStore()
    speechStore.activeSpeechProvider = 'test-configured-speech'
    speechStore.activeSpeechModel = ''
    await providersStore.initializeProvider('test-configured-speech')
    providersStore.providerRuntimeState['test-configured-speech'].models = [
      { id: 'eleven_v3', name: 'v3', provider: 'test-configured-speech' },
      { id: 'eleven_flash_v2_5', name: 'flash', provider: 'test-configured-speech' },
    ]

    speechStore.ensureActiveSpeechModel()

    expect(speechStore.activeSpeechModel).toBe('')
  })
})

describe('voice catalogs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ROOT CAUSE: Model reloads lived in the settings page, so card changes bypassed them.
  // https://github.com/moeru-ai/airi/actions/runs/39113696560/job/117634993202
  // Catalog hashing is asynchronous. Wait for each request instead of assuming it finishes within 20 ms.
  it('refreshes voices when only the active model changes outside settings', async () => {
    const providers = useProviderStore()
    const loads = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue([])
    const speech = useSpeechStore()
    speech.activeSpeechProvider = 'test-configured-speech'
    speech.activeSpeechModel = 'model-a'
    await vi.waitFor(() => {
      expect(loads).toHaveBeenCalledWith('test-configured-speech', 'model-a', expect.anything())
    })
    loads.mockClear()
    speech.activeSpeechModel = 'model-b'
    await vi.waitFor(() => {
      expect(loads).toHaveBeenCalledWith('test-configured-speech', 'model-b', expect.anything())
    })
  })

  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3964660980
  // ROOT CAUSE: Every refresh cleared the catalog, even when its identity did
  // not change. A temporary failure then removed valid cached choices.
  it('retains the same catalog on refresh failure but clears it for a different model', async () => {
    const providers = useProviderStore()
    const voices = [{ id: 'cached', name: 'Cached', languages: [], provider: 'test-speech' }]
    const loads = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue(voices)
    const speech = useSpeechStore()
    await speech.loadVoicesForProvider('test-speech', 'model-a')
    loads.mockRejectedValue(new Error('temporary outage'))
    await speech.loadVoicesForProvider('test-speech', 'model-a')
    expect(speech.availableVoices['test-speech']).toEqual(voices)
    expect(speech.voiceCatalogStatus['test-speech']?.error).toBe('temporary outage')
    await speech.loadVoicesForProvider('test-speech', 'model-b')
    expect(speech.availableVoices['test-speech']).toEqual([])
  })

  // https://github.com/moeru-ai/airi/pull/3487#discussion_r4537737568
  // ROOT CAUSE: The store keeps one catalog for each provider. A load for the selected provider with the model of
  // a character discarded that catalog and cleared the selected voice.
  it('reads the voice of a character with another model of the selected provider and keeps the selected voice', async () => {
    const providers = useProviderStore()
    const voices = [{ id: 'selected', name: 'Selected', languages: [{ code: 'en-US', title: 'English' }], provider: 'test-speech' }]
    const loads = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue(voices)
    // The output resolves its client only when it synthesizes. This test reads the language and never synthesizes.
    vi.spyOn(providers, 'getProviderInstance').mockResolvedValue({} as unknown as Awaited<ReturnType<typeof providers.getProviderInstance>>)
    const speech = useSpeechStore()
    await speech.selectProviderModel('test-speech', 'model-a')
    await vi.waitFor(() => expect(speech.isLoadingSpeechProviderVoices).toBe(false))
    speech.activeSpeechVoiceId = 'selected'
    await speech.ensureActiveSpeechVoice()
    loads.mockResolvedValue([{ id: 'character', name: 'Character', languages: [{ code: 'ja-JP', title: 'Japanese' }], provider: 'test-speech' }])

    await speech.loadVoicesForCharacter('test-speech', 'model-b')

    expect(loads).toHaveBeenLastCalledWith('test-speech', 'model-b', expect.anything())
    expect(speech.activeSpeechVoiceId).toBe('selected')
    expect(speech.availableVoices['test-speech']).toEqual(voices)
    const output = speech.createOutput({ sessionId: 'session-1', turnId: 'turn-1' }, { provider: 'test-speech', model: 'model-b', voice_id: 'character' }, { playback: {} as never }, {} as AudioContext)
    expect(output.language).toBe('ja-JP')
  })

  // https://github.com/moeru-ai/airi/pull/3491#discussion_r4538636428
  // ROOT CAUSE: The voices that a character load stored stayed first after the same provider and model became the
  // selection of the store. A later catalog of the store, for example after a settings change, did not replace them.
  it('reads the catalog of the store when the selection of a character becomes the selection of the store', async () => {
    const providers = useProviderStore()
    const loads = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue([{ id: 'voice', name: 'Voice', languages: [{ code: 'ja-JP', title: 'Japanese' }], provider: 'test-speech' }])
    vi.spyOn(providers, 'getProviderInstance').mockResolvedValue({} as unknown as Awaited<ReturnType<typeof providers.getProviderInstance>>)
    const speech = useSpeechStore()
    await speech.loadVoicesForCharacter('test-speech', 'model-b')
    loads.mockResolvedValue([{ id: 'voice', name: 'Voice', languages: [{ code: 'en-US', title: 'English' }], provider: 'test-speech' }])

    await speech.selectProviderModel('test-speech', 'model-b', 'voice')
    await vi.waitFor(() => expect(speech.availableVoices['test-speech']?.[0]?.languages[0]?.code).toBe('en-US'))

    const output = speech.createOutput({ sessionId: 'session-1', turnId: 'turn-1' }, { provider: 'test-speech', model: 'model-b', voice_id: 'voice' }, { playback: {} as never }, {} as AudioContext)
    expect(output.language).toBe('en-US')
  })

  it('does not load for a character whose speech selection is the selection of the store', async () => {
    const loads = vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue([])
    const speech = useSpeechStore()
    await speech.selectProviderModel('test-speech', 'model-a')
    await vi.waitFor(() => expect(speech.isLoadingSpeechProviderVoices).toBe(false))
    loads.mockClear()

    await speech.loadVoicesForCharacter('test-speech', 'model-a')

    expect(loads).not.toHaveBeenCalled()
  })

  it('keeps the catalog of a provider apart from the voices of a character that uses it', async () => {
    const loads = vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue([{ id: 'character', name: 'Character', languages: [], provider: 'test-configured-speech' }])
    const speech = useSpeechStore()

    await speech.loadVoicesForCharacter('test-configured-speech', 'model-c')

    expect(loads).toHaveBeenCalledWith('test-configured-speech', 'model-c', expect.anything())
    expect(speech.availableVoices['test-configured-speech'] ?? []).toEqual([])
  })

  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3966034981
  // ROOT CAUSE: Synthesis settings changed the catalog fingerprint and cleared
  // a valid selection. Each adapter must identify its discovery inputs.
  it.each(['test-configured-speech', 'test-local-speech', 'test-speech'])('retains %s selection after synthesis settings change', async (provider) => {
    const voices = [{ id: 'selected', name: 'Selected', languages: [], provider }]
    vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue(voices)
    const speech = useSpeechStore()
    await speech.selectProviderModel(provider, 'model')
    await vi.waitFor(() => expect(speech.isLoadingSpeechProviderVoices).toBe(false))
    const config = { apiKey: 'key', baseUrl: 'https://voices.invalid/', region: 'eastasia' }
    await speech.loadVoiceCatalog(provider, 'model', { definitionId: provider, config })
    speech.activeSpeechVoiceId = 'selected'
    await speech.ensureActiveSpeechVoice()
    await speech.loadVoiceCatalog(provider, 'model', {
      definitionId: provider,
      config: { ...config, pitch: 1, speed: 1.2, volume: 0.8, style: 'happy', voiceSettings: { stability: 0.7 } },
    })
    expect(speech.activeSpeechVoiceId).toBe('selected')
    expect(speech.activeSpeechVoice?.id).toBe('selected')
    expect(speech.configured).toBe(true)
  })

  it('invalidates cached voices when configuration changes or the provider session expires', async () => {
    const providers = useProviderStore()
    const voices = [{ id: 'cached', name: 'Cached', languages: [], provider: 'test-speech' }]
    const loads = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue(voices)
    const speech = useSpeechStore()
    const original = { definitionId: 'test-speech', config: { baseUrl: 'https://old.invalid/' } }
    const changed = { definitionId: 'test-speech', config: { baseUrl: 'https://new.invalid/' } }
    await speech.loadVoiceCatalog('test-speech', 'model-a', original)
    loads.mockRejectedValue(new Error('configuration unavailable'))
    await expect(speech.loadVoiceCatalog('test-speech', 'model-a', changed)).rejects.toThrow('configuration unavailable')
    expect(speech.availableVoices['test-speech']).toEqual([])
    loads.mockResolvedValue(voices)
    await speech.loadVoiceCatalog('test-speech', 'model-a', changed)
    loads.mockResolvedValue(undefined)
    await speech.loadVoiceCatalog('test-speech', 'model-a', changed)
    expect(speech.availableVoices['test-speech']).toEqual([])
    expect(speech.voiceCatalogIdentities['test-speech']).toBeUndefined()
  })

  it('discards a request reset while its configuration fingerprint is pending', async () => {
    const providers = useProviderStore()
    const original = providers.getVoiceCatalogIdentity.bind(providers)
    let finish!: () => void
    const barrier = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.spyOn(providers, 'getVoiceCatalogIdentity').mockImplementation(async (model, configuration) => {
      const identity = await original(model, configuration)
      if (model === 'delayed')
        await barrier
      return identity
    })
    const requests = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue([])
    const speech = useSpeechStore()
    const pending = speech.loadVoiceCatalog('test-speech', 'delayed', { definitionId: 'test-speech', config: {} })
    await speech.resetState()
    finish()
    await expect(pending).resolves.toEqual([])
    expect(requests.mock.calls.some(([, model]) => model === 'delayed')).toBe(false)
    expect(speech.availableVoices['test-speech']).toBeUndefined()
  })

  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3964866488
  it('keeps large provider samples out of replicated speech state', async () => {
    vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue([])
    const speech = useSpeechStore()
    await speech.loadVoiceCatalog('test-speech', 'model-a', {
      definitionId: 'test-speech',
      config: { voiceSample: 'private-sample'.repeat(100000) },
    })
    const state = JSON.stringify({ settings: speech.$state, identities: speech.voiceCatalogIdentities })
    expect(state.length).toBeLessThan(2000)
    expect(state).not.toContain('private-sample')
  })

  // https://github.com/moeru-ai/airi/pull/2490#discussion_r3963756330
  // ROOT CAUSE: A background provider's newer request hid the active provider's pending state and error.
  it('keeps active provider status when another provider finishes first', async () => {
    const providers = useProviderStore()
    const loads = vi.spyOn(providers, 'listProviderVoices').mockResolvedValue([])
    const speech = useSpeechStore()
    speech.activeSpeechProvider = 'test-speech'
    await new Promise(resolve => setTimeout(resolve, 20))
    let rejectActive!: (error: Error) => void
    loads.mockImplementation(async (provider) => {
      if (provider === 'test-speech') {
        return new Promise((_resolve, reject) => {
          rejectActive = reject
        })
      }
      return []
    })
    const active = speech.loadVoicesForProvider('test-speech')
    try {
      await vi.waitFor(() => expect(rejectActive).toBeDefined())
      await speech.loadVoicesForProvider('speech-noop')
      expect(speech.isLoadingSpeechProviderVoices).toBe(true)
      rejectActive(new Error('active provider failed'))
      await active
      expect(speech.speechProviderError).toBe('active provider failed')
      expect(speech.isLoadingSpeechProviderVoices).toBe(false)
    }
    finally {
      rejectActive?.(new Error('test cleanup'))
      await active
    }
  })
})

describe('speechFieldStatus', () => {
  it('reports a missing voice of a provider that does not pick one', () => {
    expect(speechFieldStatus({ provider: 'test-speech', model: 'speech-02-hd', voice_id: '' }, {}, () => undefined)).toEqual({ missing: ['voice'], pending: [] })
  })

  it('takes the model and the voice from the provider config', () => {
    expect(speechFieldStatus({ provider: 'test-configured-speech', model: '', voice_id: '' }, { model: 'tts-1', voice: 'alloy' }, () => null)).toEqual({ missing: [], pending: [] })
  })

  it('reports nothing when speech is off', () => {
    expect(speechFieldStatus({ provider: 'speech-noop', model: '', voice_id: '' }, {}, () => null)).toEqual({ missing: [], pending: [] })
  })
})

describe('speechFieldsKeyOf', () => {
  it('names each set of fields with one key', () => {
    expect(speechFieldsKeyOf(['model'])).toBe('model')
    expect(speechFieldsKeyOf(['voice'])).toBe('voice')
    expect(speechFieldsKeyOf(['model', 'voice'])).toBe('model-voice')
    expect(speechFieldsKeyOf([])).toBeUndefined()
  })
})
