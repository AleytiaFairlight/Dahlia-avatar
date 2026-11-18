import { isGenerationProvider } from '@proj-airi/provider-inference'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useProviderConfigStore } from './config'
import { useProviderStore } from './provider'

// Dahlia: stand-in providers for the tests; the apps register only Dahlia's.
import '../../libs/providers/providers/test-providers'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('provider store synchronization boundary', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ROOT CAUSE:
  //
  // Provider actions, serializable runtime data, and computedAsync output
  // shared one synced store. Applying the derived ref in every Electron
  // renderer restarted its local async computation, which proposed another
  // snapshot and starved the main window's event loop.
  //
  // We fixed this by keeping executable actions in the provider store and
  // placing the replicated data in an internal state-only store.
  it('keeps replicated runtime data out of the executable provider store state', () => {
    const store = useProviderStore()
    const runtimeState = {
      models: [],
      defaultModel: null,
      modelStatus: 'ready' as const,
      modelError: null,
    }

    store.providerRuntimeState['test-chat'] = runtimeState

    expect(store.$state).not.toHaveProperty('providerRuntimeState')
    expect(store.$state).not.toHaveProperty('providerAvailabilityOverrides')
    expect(store.providerRuntimeState['test-chat']).toEqual(runtimeState)
  })

  // ROOT CAUSE:
  //
  // The provider store installed immediate watchers that called synchronized
  // background actions. Every renderer created the same watchers, so one
  // shared state transition produced one routed action per renderer.
  //
  // We fixed this by keeping background work behind explicit action calls.
  it('does not start background provider actions when shared configuration changes', async () => {
    const store = useProviderStore()
    const configStore = useProviderConfigStore()

    await nextTick()
    await new Promise<void>(resolve => queueMicrotask(resolve))

    const refreshValidation = vi.spyOn(store, 'refreshListedProviderValidation').mockResolvedValue()
    const refreshModels = vi.spyOn(store, 'refreshModelsForChangedCredentials').mockResolvedValue()

    configStore.ensureProvider('test-chat', 'test-chat', { apiKey: 'test-key' })
    await nextTick()
    await new Promise<void>(resolve => queueMicrotask(resolve))

    expect(refreshValidation).not.toHaveBeenCalled()
    expect(refreshModels).not.toHaveBeenCalled()
  })

  // ROOT CAUSE:
  //
  // Provider metadata projection called the config store's `getProvider`
  // action once for every registered provider. Pinia tracing and plugins then
  // processed hundreds of action lifecycle events during renderer startup,
  // even though each call was only a read.
  // Internal provider projections now read the reactive provider map directly.
  it('does not dispatch config actions while projecting provider metadata', async () => {
    const configStore = useProviderConfigStore()
    let getProviderCalls = 0
    configStore.$onAction(({ name }) => {
      if (name === 'getProvider')
        getProviderCalls += 1
    })

    useProviderStore()
    await nextTick()

    expect(getProviderCalls).toBe(0)
  })

  // ROOT CAUSE:
  //
  // Speech settings pages wrote defaults into the computed `configs` map before
  // provider initialization. The derived entry made `initializeProvider` skip
  // the source provider record, so later input was not persisted.
  //
  // The provider record is now the only existence check. A derived entry cannot
  // prevent initialization of the persisted source state.
  // https://github.com/moeru-ai/airi/issues/2449
  it('creates the provider when only a derived configuration entry exists (Issue #2449)', async () => {
    const store = useProviderStore()
    const configStore = useProviderConfigStore()

    configStore.configs['test-configured-speech'] = { model: 'qwen' }

    expect(configStore.getProvider('test-configured-speech')).toBeUndefined()

    await store.initializeProvider('test-configured-speech')

    expect(configStore.getProvider('test-configured-speech')).toMatchObject({
      id: 'test-configured-speech',
      definitionId: 'test-configured-speech',
    })
  })

  it('uses the current interface language when Sherpaw is first configured', async () => {
    let storedLanguage = 'en'
    vi.stubGlobal('localStorage', { getItem: () => storedLanguage })

    try {
      const store = useProviderStore()
      const configStore = useProviderConfigStore()

      await store.initializeProvider('speech-noop')
      storedLanguage = 'zh-Hans'
      await store.initializeProvider('sherpaw-transcription')

      expect(configStore.getProviderConfig('sherpaw-transcription')).toMatchObject({
        model: 'paraformer-zh-en',
        modelLanguageFilter: 'zh',
      })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  // ROOT CAUSE:
  //
  // getModelsForProvider created a new empty array for every cache miss.
  // Reactive consumers observed a false list change after each synced patch.
  //
  // We fixed this by returning one frozen fallback until a catalog exists.
  it('reuses the empty model-list fallback', () => {
    const store = useProviderStore()

    const first = store.getModelsForProvider('missing-provider')
    const second = store.getModelsForProvider('missing-provider')

    expect(second).toBe(first)
    expect(second).toEqual([])
  })

  it('applies provider-owned reasoning options without changing the cached provider', async () => {
    const store = useProviderStore()
    const configStore = useProviderConfigStore()
    configStore.ensureProvider('test-chat', 'test-chat', {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1/',
    })

    const baseProvider = await store.getProviderInstance('test-chat')
    const reasoningDisabledProvider = await store.getChatProviderInstance('test-chat', { reasoning: 'disabled' })
    const reasoningEnabledProvider = await store.getChatProviderInstance('test-chat', { reasoning: 'enabled' })

    expect(reasoningDisabledProvider).not.toBe(baseProvider)
    expect(reasoningEnabledProvider).not.toBe(baseProvider)
    expect(reasoningDisabledProvider.generation('test-model').config).toMatchObject({ reasoning: { effort: 'none' } })
    expect(reasoningEnabledProvider.generation('test-model').config).toMatchObject({ reasoning: { effort: 'medium' } })
    if (!isGenerationProvider(baseProvider))
      throw new Error('Expected generation provider')
    expect(baseProvider.generation('test-model').config).not.toHaveProperty('reasoning')
  })

  // https://github.com/moeru-ai/airi/pull/2471#discussion_r3999470560
  it('drops a cached instance when replicated credentials change', async () => {
    // A follower window, such as the chat window, receives a new key in the replicated snapshot.
    // Each renderer watches the replicated credentials and drops its own cached client.
    const store = useProviderStore()
    const configStore = useProviderConfigStore()
    configStore.ensureProvider('test-chat', 'test-chat', {
      apiKey: 'sk-old',
      baseUrl: 'https://api.openai.com/v1/',
    })
    const first = await store.getProviderInstance('test-chat')

    configStore.providers['test-chat'] = {
      ...configStore.providers['test-chat']!,
      config: {
        apiKey: 'sk-new',
        baseUrl: 'https://api.openai.com/v1/',
      },
    }

    const second = await store.getProviderInstance('test-chat')
    expect(second).not.toBe(first)
  })
})
