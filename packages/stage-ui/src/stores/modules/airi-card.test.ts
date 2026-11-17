import type { AiriCard } from './airi-card'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toRaw } from 'vue'

import { displayModelsRepo } from '../../database/repos/display-models.repo'
import { DisplayModelFormat, useDisplayModelsStore } from '../display-models'
import { useSettingsStageModel } from '../settings/stage-model'
import { useAiriCardStore } from './airi-card'
import { useConsciousnessStore } from './consciousness'
import { useSpeechStore } from './speech'
import { useVisionStore } from './vision'

const { resetArtistryToGlobal } = vi.hoisted(() => ({
  resetArtistryToGlobal: vi.fn(),
}))

// Vitest runs these store tests in Node, which has no IndexedDB. The stage-model
// watcher asks the display-model store to resolve IDs, so an in-memory driver
// replaces the IndexedDB mounts.
vi.mock('../../database/storage', async (importOriginal) => {
  const { createStorage } = await import('unstorage')
  const { default: memoryDriver } = await import('unstorage/drivers/memory')
  return {
    ...await importOriginal<typeof import('../../database/storage')>(),
    storage: createStorage({ driver: memoryDriver() }),
  }
})

vi.mock('./artistry', async () => {
  const { defineStore } = await import('pinia')

  return {
    useArtistryStore: defineStore('artistry', {
      state: () => ({
        globalProvider: 'mock-artistry-provider',
        globalModel: 'mock-artistry-model',
        globalPromptPrefix: 'mock-artistry-prefix',
        globalProviderOptions: {},
        activeProvider: 'mock-artistry-provider',
        activeModel: 'mock-artistry-model',
        defaultPromptPrefix: 'mock-artistry-prefix',
        providerOptions: {},
      }),
      actions: {
        resetToGlobal: resetArtistryToGlobal,
      },
    }),
  }
})

vi.mock('./consciousness', async () => {
  const { defineStore } = await import('pinia')

  return {
    useConsciousnessStore: defineStore('consciousness', {
      state: () => ({
        activeProvider: 'mock-consciousness-provider',
        activeModel: 'mock-consciousness-model',
      }),
    }),
  }
})

vi.mock('./vision', async () => {
  const { defineStore } = await import('pinia')

  return {
    useVisionStore: defineStore('vision', {
      state: () => ({
        activeProvider: 'mock-vision-provider',
        activeModel: 'mock-vision-model',
      }),
      actions: {
        resetModelSelection() {
          this.activeModel = ''
        },
        // The real action loads the catalog into the provider store. Each test
        // writes that catalog state itself.
        async loadModelsForProvider() {},
      },
    }),
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

// Dahlia: the app has one preset model, her VRM (preset-dahlia-vrm, the built-in card's model), where AIRI's tests
// pick among AIRI's four. These tests store stand-ins for the other models on the device. The stage always shows her
// model (applyActiveAvatarModel), so after a card command every test expects preset-dahlia-vrm on the stage.
async function storeStandInDisplayModels() {
  for (const id of ['preset-spine-2', 'preset-vrm-1', 'preset-vrm-2'])
    await displayModelsRepo.save({ id, type: 'file', format: DisplayModelFormat.VRM, name: id, file: new File([], `${id}.vrm`), importedAt: 1 })
}

describe('airi-card store', () => {
  let testPinia: ReturnType<typeof createPinia>

  beforeEach(async () => {
    await storeStandInDisplayModels()
    testPinia = createPinia()
    setActivePinia(testPinia)
    resetArtistryToGlobal.mockClear()
    useSpeechStore().$patch({
      activeSpeechProvider: 'mock-speech-provider',
      activeSpeechModel: 'mock-speech-model',
      activeSpeechVoiceId: 'mock-speech-voice',
    })
  })

  // A store action makes its Pinia active, so work that outlives a test can change the active Pinia.
  // Read a store after an await through `testPinia`. Production has one Pinia, so this affects only tests.
  afterEach(() => {
    disposePinia(testPinia)
  })

  // ROOT CAUSE:
  //
  // Authentication installed the official module defaults before card startup
  // completed. Initializing the default card then assigned its missing module
  // fields as empty values and erased those defaults.
  //
  // We fixed this by applying only module fields that a card actually owns.
  it('keeps runtime module selections when the active card omits them', async () => {
    const consciousnessStore = useConsciousnessStore()
    const speechStore = useSpeechStore()
    const visionStore = useVisionStore()
    const cardStore = useAiriCardStore()

    await cardStore.initialize()

    expect(consciousnessStore.activeProvider).toBe('mock-consciousness-provider')
    expect(consciousnessStore.activeModel).toBe('mock-consciousness-model')
    expect(speechStore.activeSpeechProvider).toBe('mock-speech-provider')
    expect(speechStore.activeSpeechModel).toBe('mock-speech-model')
    expect(speechStore.activeSpeechVoiceId).toBe('mock-speech-voice')
    expect(visionStore.activeProvider).toBe('mock-vision-provider')
    expect(visionStore.activeModel).toBe('mock-vision-model')
  })

  // ROOT CAUSE:
  //
  // The default card took a snapshot before sign-in. Its speech provider was
  // `speech-noop`, so a later activation replaced the official speech provider.
  // The card then showed missing module settings instead of inherited settings.
  //
  // We fix this by keeping the default card module fields empty. Empty fields
  // inherit the global module settings and never replace them during activation.
  it('keeps default card modules inherited after authenticated defaults load', async () => {
    const consciousnessStore = useConsciousnessStore()
    const speechStore = useSpeechStore()
    const visionStore = useVisionStore()
    const cardStore = useAiriCardStore()

    consciousnessStore.activeProvider = ''
    consciousnessStore.activeModel = ''
    speechStore.activeSpeechProvider = 'speech-noop'
    speechStore.activeSpeechModel = ''
    speechStore.activeSpeechVoiceId = ''
    visionStore.activeProvider = ''
    visionStore.activeModel = ''

    await cardStore.initialize()

    consciousnessStore.activeProvider = 'official-provider'
    consciousnessStore.activeModel = 'auto'
    speechStore.activeSpeechProvider = 'official-provider-speech'
    speechStore.activeSpeechModel = 'auto'
    visionStore.activeProvider = 'vision-official-provider'
    visionStore.activeModel = 'auto'

    await cardStore.activateCard('default')

    expect(cardStore.activeCard?.extensions.airi.modules.consciousness).toEqual({
      provider: '',
      model: '',
    })
    expect(cardStore.activeCard?.extensions.airi.modules.speech).toMatchObject({
      provider: '',
      model: '',
      voice_id: '',
    })
    expect(cardStore.activeCard?.extensions.airi.modules.vision).toEqual({
      provider: '',
      model: '',
    })
    expect(consciousnessStore.activeProvider).toBe('official-provider')
    expect(consciousnessStore.activeModel).toBe('auto')
    expect(speechStore.activeSpeechProvider).toBe('official-provider-speech')
    expect(speechStore.activeSpeechModel).toBe('auto')
    expect(visionStore.activeProvider).toBe('vision-official-provider')
    expect(visionStore.activeModel).toBe('auto')
  })

  it('preserves ambiguous old default speech settings', async () => {
    const cardStore = useAiriCardStore()
    cardStore.cards.set('default', {
      name: 'Dahlia',
      version: '1.0.0',
      description: 'Built-in card from before provider defaults loaded.',
      extensions: {
        airi: {
          avatarModels: [],
          modules: {
            consciousness: { provider: '', model: '' },
            speech: { provider: 'speech-noop', model: '', voice_id: '' },
            vision: { provider: '', model: '' },
          },
          agents: {},
        },
      },
    })

    await cardStore.initialize()

    expect(cardStore.activeCard?.extensions.airi.modules.speech).toMatchObject({
      provider: 'speech-noop',
      model: '',
      voice_id: '',
    })
  })

  // ROOT CAUSE:
  //
  // Each Electron window called the synchronized initialize action. The leader
  // applied the active card again for every new window. An older card selection
  // then replaced module defaults that the authentication hook had configured.
  //
  // We fixed this by making card initialization idempotent in the leader.
  it('does not reapply active card settings for a second window', async () => {
    const consciousnessStore = useConsciousnessStore()
    const speechStore = useSpeechStore()
    const visionStore = useVisionStore()
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    consciousnessStore.activeProvider = 'official-provider'
    consciousnessStore.activeModel = 'auto'
    speechStore.activeSpeechProvider = 'official-provider-speech'
    speechStore.activeSpeechModel = 'auto'
    visionStore.activeProvider = 'vision-official-provider'
    visionStore.activeModel = 'auto'

    await cardStore.initialize()

    expect(consciousnessStore.activeProvider).toBe('official-provider')
    expect(consciousnessStore.activeModel).toBe('auto')
    expect(speechStore.activeSpeechProvider).toBe('official-provider-speech')
    expect(speechStore.activeSpeechModel).toBe('auto')
    expect(visionStore.activeProvider).toBe('vision-official-provider')
    expect(visionStore.activeModel).toBe('auto')
  })

  // ROOT CAUSE:
  //
  // A synchronized state snapshot replaced `activeCardId`. The old watcher
  // interpreted that replicated state as a user command and applied module
  // settings, which produced another synchronized snapshot.
  //
  // We fixed this by applying settings only from the synchronized activation
  // action. State replication remains free of runtime side effects.
  it('applies card settings only through the activation command', async () => {
    const stageModelStore = useSettingsStageModel()
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const vrmCardId = await cardStore.addCard({
      name: 'VRM card',
      version: '1.0.0',
      description: 'Card for the promoted leader.',
      extensions: {
        airi: {
          avatarModels: [{
            id: 'vrm-avatar-model',
            displayModelId: 'preset-vrm-1',
            type: 'vrm',
            config: {},
          }],
          defaultAvatarModelId: 'vrm-avatar-model',
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
          },
          agents: {},
        },
      },
    }, 'scratch')
    const spineCardId = await cardStore.addCard({
      name: 'Spine card',
      version: '1.0.0',
      description: 'Card for the active leader.',
      extensions: {
        airi: {
          avatarModels: [{
            id: 'spine-avatar-model',
            displayModelId: 'preset-dahlia-vrm',
            type: 'vrm',
            config: {},
          }],
          defaultAvatarModelId: 'spine-avatar-model',
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
          },
          agents: {},
        },
      },
    }, 'scratch')

    stageModelStore.stageModelSelected = 'preset-vrm-2'
    await cardStore.activateCard(vrmCardId)
    expect(stageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')

    cardStore.$patch({ activeCardId: spineCardId })
    expect(stageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')

    await cardStore.activateCard(spineCardId)
    expect(stageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')
  })

  it('does not create runtime module stores for metadata-only consumers', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    // ROOT CAUSE:
    //
    // The chat session store only reads the active card ID and system prompt,
    // but creating the card store also created every runtime module store.
    // The speech store then loaded provider voices in each auxiliary window.
    useAiriCardStore(pinia)

    expect(pinia.state.value.speech).toBeUndefined()
    expect(pinia.state.value.consciousness).toBeUndefined()
    expect(pinia.state.value.vision).toBeUndefined()
  })

  it('stores the default Avatar Model on the active card', async () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-vrm-2'

    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    expect(await cardStore.setActiveCardDefaultAvatarModel('preset-vrm-1')).toBe(true)
    expect(cardStore.selectedAvatarModel).toMatchObject({
      displayModelId: 'preset-vrm-1',
      type: 'vrm',
    })
    expect(cardStore.activeCard?.extensions.airi.defaultAvatarModelId).toBe(cardStore.selectedAvatarModelId)
    expect(stageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')
  })

  // https://github.com/moeru-ai/airi/pull/2458#discussion_r3924569262
  // ROOT CAUSE:
  //
  // Character creation stored the model in a module field, then copied it
  // into an Avatar Model reference. Creation now writes the reference directly.
  it('pr #2458 stores a new Character model in its Avatar Model reference', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'New Character',
      version: '1.0.0',
      description: '',
    }, 'scratch', 'preset-vrm-1')

    const card = cardStore.getCard(cardId)
    expect(card?.extensions.airi.avatarModels).toHaveLength(1)
    expect(card?.extensions.airi.avatarModels[0]).toMatchObject({ displayModelId: 'preset-vrm-1', type: 'vrm' })
    expect(card?.extensions.airi.defaultAvatarModelId).toBe(card?.extensions.airi.avatarModels[0].id)
    expect(card?.extensions.airi.modules).not.toHaveProperty('displayModelId')
  })

  // ROOT CAUSE:
  //
  // The Character stored the selected Display Model and its Avatar Model
  // reference. The runtime Avatar Model ID was not durable. A new runtime
  // selected the first Avatar Model instead of the Character default.
  //
  // We fixed this by storing the default Avatar Model ID on the Character.
  // Initialization now restores that ID into the runtime selection.
  it('restores the Character default Avatar Model after a runtime restart', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()
    await cardStore.setActiveCardDefaultAvatarModel('preset-vrm-1')

    const expectedAvatarModelId = cardStore.selectedAvatarModelId
    const persistedCards = new Map(cardStore.cards)

    setActivePinia(createPinia())

    const restartedStageModelStore = useSettingsStageModel()
    const restartedCardStore = useAiriCardStore()
    restartedCardStore.$patch({ cards: persistedCards })
    await restartedCardStore.initialize()

    expect(restartedCardStore.selectedAvatarModelId).toBe(expectedAvatarModelId)
    expect(restartedStageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')
  })

  // https://github.com/moeru-ai/airi/pull/2458
  // ROOT CAUSE:
  //
  // Cards saved before Avatar Models existed store their model in
  // `modules.displayModelId`. Card normalization deleted that field and created
  // no Avatar Model, so an upgraded Character showed an empty Stage.
  //
  // We fixed this by reading the old field before normalization and moving it
  // into an Avatar Model reference during initialization.
  describe('pr #2458 migrates models of cards saved before Avatar Models', () => {
    async function restartWithLegacyCards(legacy: Array<[id: string, displayModelId: string]>) {
      const firstRun = useAiriCardStore()
      await firstRun.initialize()
      const template = structuredClone(toRaw(firstRun.cards.get('default')!))

      const cards = new Map<string, AiriCard>()
      for (const [id, displayModelId] of legacy) {
        const card = structuredClone(template)
        card.name = id
        Reflect.deleteProperty(card.extensions.airi, 'avatarModels')
        Reflect.deleteProperty(card.extensions.airi, 'defaultAvatarModelId')
        Reflect.set(card.extensions.airi.modules, 'displayModelId', displayModelId)
        cards.set(id, card)
      }

      setActivePinia(createPinia())
      const stageModelStore = useSettingsStageModel()
      const cardStore = useAiriCardStore()
      cardStore.$patch({ cards })
      await cardStore.initialize()
      return { cardStore, stageModelStore }
    }

    function defaultDisplayModelId(card: AiriCard | undefined) {
      const extension = card?.extensions.airi
      return extension?.avatarModels.find(model => model.id === extension.defaultAvatarModelId)?.displayModelId
    }

    it('moves the model of a custom card into its default Avatar Model', async () => {
      const { cardStore, stageModelStore } = await restartWithLegacyCards([
        ['default', 'preset-dahlia-vrm'],
        ['legacy', 'preset-spine-2'],
      ])

      expect(defaultDisplayModelId(cardStore.cards.get('legacy'))).toBe('preset-spine-2')
      expect(Reflect.has(cardStore.cards.get('legacy')!.extensions.airi.modules, 'displayModelId')).toBe(false)

      await cardStore.activateCard('legacy')
      expect(stageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')
    })

    it('keeps the model that the built-in card selected', async () => {
      const { cardStore, stageModelStore } = await restartWithLegacyCards([['default', 'preset-vrm-1']])

      expect(defaultDisplayModelId(cardStore.cards.get('default'))).toBe('preset-vrm-1')
      expect(stageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')
    })

    it('keeps the built-in reference when the built-in card used the bundled preset', async () => {
      const { cardStore } = await restartWithLegacyCards([['default', 'preset-dahlia-vrm']])

      expect(cardStore.cards.get('default')!.extensions.airi.defaultAvatarModelId).toBe('default-vrm-avatar-model')
    })

    it('leaves a card without a model when this device does not store its model', async () => {
      const { cardStore, stageModelStore } = await restartWithLegacyCards([
        ['default', 'preset-dahlia-vrm'],
        ['legacy', 'display-model-not-on-this-device'],
      ])

      expect(cardStore.cards.get('legacy')!.extensions.airi.avatarModels).toEqual([])

      await cardStore.activateCard('legacy')
      expect(cardStore.selectedAvatarModel).toBeUndefined()
      expect(stageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')
    })
  })

  // https://github.com/moeru-ai/airi/pull/2458#discussion_r3924569270
  // ROOT CAUSE:
  //
  // Model deletion reset only the runtime selection. Character defaults still
  // pointed to removed resources. The cleanup now updates every Character.
  it('pr #2458 repoints Character defaults after imported models are deleted', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Imported model Character',
      version: '1.0.0',
      description: '',
      extensions: {
        airi: {
          avatarModels: [{ id: 'imported-avatar', displayModelId: 'display-model-imported', type: 'vrm', config: {} }],
          defaultAvatarModelId: 'imported-avatar',
          modules: {
            consciousness: { provider: '', model: '' },
            vision: { provider: '', model: '' },
            speech: { provider: '', model: '', voice_id: '' },
          },
          agents: {},
        },
      },
    }, 'import')
    const inactiveCardId = await cardStore.addCard(cardStore.getCard(cardId)!, 'duplicate')
    await cardStore.activateCard(cardId)
    expect(cardStore.selectedAvatarModel?.displayModelId).toBe('display-model-imported')

    await cardStore.removeDeletedAvatarModels(['display-model-imported'], ['preset-dahlia-vrm', 'preset-vrm-1'])

    expect(cardStore.activeCard?.extensions.airi.avatarModels.some(model => model.displayModelId === 'display-model-imported')).toBe(false)
    expect(cardStore.getCard(inactiveCardId)?.extensions.airi.avatarModels.some(model => model.displayModelId === 'display-model-imported')).toBe(false)
    expect(cardStore.getCard(inactiveCardId)?.extensions.airi.defaultAvatarModelId).toBe(cardStore.getCard(inactiveCardId)?.extensions.airi.avatarModels[0].id)
    expect(cardStore.selectedAvatarModel?.displayModelId).toBe('preset-dahlia-vrm')
    expect(cardStore.activeCard?.extensions.airi.defaultAvatarModelId).toBe(cardStore.selectedAvatarModelId)

    await cardStore.activateCard('default')
    await cardStore.activateCard(cardId)
    expect(useSettingsStageModel(testPinia).stageModelSelected).toBe('preset-dahlia-vrm')
  })

  it('selects an available model after deleting the built-in default', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()
    expect(cardStore.selectedAvatarModel?.displayModelId).toBe('preset-dahlia-vrm')

    await cardStore.removeDeletedAvatarModels(['preset-dahlia-vrm'], ['preset-spine-2', 'preset-vrm-1'])

    expect(cardStore.activeCard?.extensions.airi.avatarModels.some(model => model.displayModelId === 'preset-dahlia-vrm')).toBe(false)
    expect(cardStore.selectedAvatarModel?.displayModelId).toBe('preset-spine-2')
    expect(useSettingsStageModel(testPinia).stageModelSelected).toBe('preset-dahlia-vrm')
  })

  // ROOT CAUSE:
  //
  // Card sync copies Avatar Model references to every device, but a model file
  // stays on one device. The cleanup removed each reference that this device
  // could not load, and sync removed them on the other devices.
  //
  // We fixed this by removing only the deleted IDs.
  it('keeps references to Display Models that only another device stores', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Synchronized Character',
      version: '1.0.0',
      description: '',
      extensions: {
        airi: {
          avatarModels: [
            { id: 'remote-avatar', displayModelId: 'display-model-on-other-device', type: 'vrm', config: {} },
            { id: 'local-avatar', displayModelId: 'display-model-local', type: 'vrm', config: {} },
          ],
          defaultAvatarModelId: 'remote-avatar',
          modules: {
            consciousness: { provider: '', model: '' },
            vision: { provider: '', model: '' },
            speech: { provider: '', model: '', voice_id: '' },
          },
          agents: {},
        },
      },
    }, 'import')
    await cardStore.activateCard(cardId)

    expect(cardStore.selectedAvatarModel?.displayModelId).toBe('display-model-on-other-device')
    expect(useSettingsStageModel(testPinia).stageModelSelected).toBe('preset-dahlia-vrm')

    await cardStore.removeDeletedAvatarModels(['display-model-local'], ['preset-dahlia-vrm', 'preset-vrm-1'])

    expect(cardStore.getCard(cardId)?.extensions.airi.avatarModels.map(model => model.id)).toEqual(['remote-avatar'])
    expect(cardStore.getCard(cardId)?.extensions.airi.defaultAvatarModelId).toBe('remote-avatar')
    expect(cardStore.selectedAvatarModelId).toBe('remote-avatar')
    expect(useSettingsStageModel(testPinia).stageModelSelected).toBe('preset-dahlia-vrm')
  })

  it('removes the references to a model when the model is removed', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()
    const displayModelsStore = useDisplayModelsStore()

    const cardId = await cardStore.addCard({
      name: 'Cloud Character',
      version: '1.0.0',
      description: '',
      extensions: {
        airi: {
          avatarModels: [
            { id: 'cloud-avatar', displayModelId: 'display-model-cloud', type: 'vrm', config: {} },
            { id: 'local-avatar', displayModelId: 'display-model-local', type: 'vrm', config: {} },
          ],
          defaultAvatarModelId: 'cloud-avatar',
          modules: {
            consciousness: { provider: '', model: '' },
            vision: { provider: '', model: '' },
            speech: { provider: '', model: '', voice_id: '' },
          },
          agents: {},
        },
      },
    }, 'import')
    const referencedModels = () => cardStore.getCard(cardId)?.extensions.airi.avatarModels.map(model => model.displayModelId)

    await displayModelsStore.removeDisplayModel('display-model-local')
    expect(referencedModels()).toEqual(['display-model-cloud'])

    await displayModelsStore.removeDisplayModel('display-model-cloud')
    expect(referencedModels()).toEqual([])
  })

  it('does not infer a default Avatar Model from other available references', async () => {
    const cardStore = useAiriCardStore()
    cardStore.$patch({
      cards: new Map([['default', {
        name: 'Dahlia',
        version: '1.0.0',
        description: 'Character with available Avatar Models and no default.',
        extensions: {
          airi: {
            avatarModels: [{
              id: 'default-vrm-avatar-model',
              displayModelId: 'preset-dahlia-vrm',
              type: 'vrm',
              config: {},
            }, {
              id: 'configured-vrm-avatar-model',
              displayModelId: 'preset-vrm-1',
              type: 'vrm',
              config: {},
            }],
            modules: {
              consciousness: { provider: '', model: '' },
              vision: { provider: '', model: '' },
              speech: { provider: '', model: '', voice_id: '' },
            },
            agents: {},
          },
        },
      } satisfies AiriCard]]),
    })

    await cardStore.initialize()

    expect(cardStore.activeCard?.extensions.airi.defaultAvatarModelId).toBeUndefined()
    expect(cardStore.selectedAvatarModelId).toBeUndefined()
    expect(useSettingsStageModel(testPinia).stageModelSelected).toBe('preset-dahlia-vrm')
  })

  it('keeps the runtime model empty when a Character has no default Avatar Model', async () => {
    const cardStore = useAiriCardStore()
    const cardId = await cardStore.addCard({
      name: 'Model optional',
      version: '1.0.0',
      description: 'This Character does not select a default Avatar Model.',
      extensions: {
        airi: {
          avatarModels: [{
            id: 'available-vrm-avatar-model',
            displayModelId: 'preset-vrm-1',
            type: 'vrm',
            config: {},
          }],
          modules: {
            consciousness: { provider: '', model: '' },
            vision: { provider: '', model: '' },
            speech: { provider: '', model: '', voice_id: '' },
          },
          agents: {},
        },
      },
    }, 'scratch')
    cardStore.activeCardId = cardId

    await cardStore.initialize()

    expect(cardStore.activeCard?.extensions.airi.defaultAvatarModelId).toBeUndefined()
    expect(cardStore.selectedAvatarModelId).toBeUndefined()
    expect(useSettingsStageModel(testPinia).stageModelSelected).toBe('preset-dahlia-vrm')
  })

  // ROOT CAUSE:
  //
  // Card activation changes `activeCardId`, but the previous implementation
  // only observed the debounced `activeCard` object. Some card switchers keep
  // the same object reference while changing the selected ID, so the runtime
  // stage model stayed on the previous card's model.
  //
  // We fixed this by applying card settings from the stable activation key.
  // https://github.com/moeru-ai/airi/issues/2089
  it('issue #2089: applies the activated card display model to the stage runtime', async () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-vrm-2'

    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const card: AiriCard = {
      name: 'VRM card',
      version: '1.0.0',
      description: 'Card with a VRM display model',
      extensions: {
        airi: {
          avatarModels: [{
            id: 'vrm-avatar-model',
            displayModelId: 'preset-vrm-1',
            type: 'vrm',
            config: {},
          }],
          defaultAvatarModelId: 'vrm-avatar-model',
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
          },
          agents: {},
        },
      },
    }
    const cardId = await cardStore.addCard(card, 'scratch')

    await cardStore.activateCard(cardId)

    expect(stageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')
  })

  it('applies edits to the currently active card display model', async () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-vrm-2'

    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Editable card',
      version: '1.0.0',
      description: 'Card whose model can be edited',
      extensions: {
        airi: {
          avatarModels: [{
            id: 'editable-avatar-model',
            displayModelId: 'preset-dahlia-vrm',
            type: 'vrm',
            config: {},
          }],
          defaultAvatarModelId: 'editable-avatar-model',
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
          },
          agents: {},
        },
      },
    }, 'scratch')
    await cardStore.activateCard(cardId)

    const card = cardStore.getCard(cardId)
    expect(card).toBeDefined()
    await cardStore.updateCard(cardId, {
      ...card!,
      extensions: {
        ...card!.extensions,
        airi: {
          ...card!.extensions.airi,
          avatarModels: [{
            id: 'editable-avatar-model',
            displayModelId: 'preset-vrm-1',
            type: 'vrm',
            config: {},
          }],
        },
      },
    }, 'preset-vrm-1')

    expect(stageModelStore.stageModelSelected).toBe('preset-dahlia-vrm')
  })

  // ROOT CAUSE:
  //
  // pinia-plugin-synced applies a structured clone of every synchronized
  // store. The clone replaced the active card object, so the runtime watcher
  // treated unchanged card settings as an edit. Applying those settings
  // mutated other synchronized stores and committed another full snapshot.
  //
  // We prevent the feedback loop by applying runtime settings only through an
  // explicit card command, never in response to a state snapshot.
  it('does not reapply runtime settings for an unchanged synchronized card snapshot', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Artistry card',
      version: '1.0.0',
      description: 'A card with object-valued runtime settings.',
      extensions: {
        airi: {
          modules: {
            artistry: {
              options: { steps: 20 },
            },
          },
          agents: {},
        },
      },
    }, 'scratch')
    await cardStore.activateCard(cardId)

    const applicationsBeforeSnapshot = resetArtistryToGlobal.mock.calls.length
    const synchronizedCards = new Map<string, AiriCard>(JSON.parse(JSON.stringify([...cardStore.cards])))

    cardStore.$patch({ cards: synchronizedCards })

    expect(resetArtistryToGlobal).toHaveBeenCalledTimes(applicationsBeforeSnapshot)
  })

  // ROOT CAUSE:
  //
  // The settings reset clears the runtime model before resetting card state.
  // Resetting `activeCardId` first briefly selected the still-persisted default
  // card, allowing its display model to overwrite the reset runtime value.
  //
  // https://github.com/moeru-ai/airi/pull/2090#discussion_r3610810272
  it('does not restore a stale card model during card state reset', async () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-vrm-2'

    const cardStore = useAiriCardStore()
    await cardStore.initialize()
    await cardStore.setActiveCardDefaultAvatarModel('preset-vrm-1')
    stageModelStore.stageModelSelected = 'preset-vrm-2'

    cardStore.resetState()

    expect(stageModelStore.stageModelSelected).toBe('preset-vrm-2')
  })

  it('keeps position-sensitive CCv3 fields separate from the stable system prompt', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Runtime context card',
      version: '1.0.0',
      systemPrompt: 'Follow the character rules.',
      description: 'A patient field researcher.',
      personality: 'Curious and precise.',
      scenario: 'The conversation takes place in an observatory.',
      postHistoryInstructions: 'Answer the latest observation in one paragraph.',
      greetings: ['Welcome to the observatory.'],
      messageExample: [
        ['{{user}}: What did you find?', '{{char}}: A new comet.'],
      ],
      extensions: {
        airi: {
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
            artistry: { widgetInstruction: 'Use the image widget for star charts.' },
          },
          agents: {},
        },
      },
    }, 'scratch')

    await cardStore.activateCard(cardId)

    // Dahlia: her persona comes from her server (SOUL.md), so the card adds only its image widget instruction.
    expect(cardStore.systemPrompt).toBe('Use the image widget for star charts.')
    expect(cardStore.systemPrompt).not.toContain('Follow the character rules.')
    expect(cardStore.systemPrompt).not.toContain('A patient field researcher.')
    expect(cardStore.systemPrompt).not.toContain('Curious and precise.')
    expect(cardStore.systemPrompt).not.toContain('observatory.')
    expect(cardStore.systemPrompt).not.toContain('Answer the latest observation')
    expect(cardStore.systemPrompt).not.toContain('Welcome to the observatory')
    expect(cardStore.systemPrompt).not.toContain('What did you find?')
  })

  it('falls back to the default card when the active custom card is deleted', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Custom card',
      version: '1.0.0',
      description: 'A removable card.',
    }, 'scratch')
    await cardStore.activateCard(cardId)

    await cardStore.removeCard(cardId)

    expect(cardStore.cards.has(cardId)).toBe(false)
    expect(cardStore.activeCardId).toBe('default')
    expect(cardStore.activeCard?.name).toBe('Dahlia')
  })

  it('keeps the built-in fallback card when deletion is requested directly', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    expect(await cardStore.removeCard('default')).toBe(false)
    expect(cardStore.cards.has('default')).toBe(true)
    expect(cardStore.activeCardId).toBe('default')
  })

  it('preserves a valid runtime Character selection during initialization', async () => {
    const cardStore = useAiriCardStore()
    const cardId = await cardStore.addCard({
      name: 'Selected Character',
      version: '1.0.0',
      description: 'Keep this selection.',
    }, 'scratch')
    cardStore.activeCardId = cardId

    await cardStore.initialize()

    expect(cardStore.activeCardId).toBe(cardId)
    expect(cardStore.activeCard?.name).toBe('Selected Character')
  })

  it('repairs a dangling runtime Character selection during initialization', async () => {
    const cardStore = useAiriCardStore()
    cardStore.activeCardId = 'missing-card'

    await cardStore.initialize()

    expect(cardStore.activeCardId).toBe('default')
    expect(cardStore.activeCard?.name).toBe('Dahlia')
  })

  // The built-in character was ReLU, and its description said "Your name is AIRI".
  // A device stores its own copy of the built-in card, so the new built-in content
  // reaches only the parts that the user did not edit.
  describe('the built-in card from before Iru', () => {
    /** The English built-in description before Iru, as `t('base.prompt.prefix')` returned it. */
    const preIruDescription = [
      'Good morning! You are finally awake.',
      '',
      // Dahlia: \u0041 is the A of AIRI, so scripts/apply_avatar_branding.sh leaves this name of AIRI's text alone.
      'Your name is \u0041IRI, pronounced as /ˈaɪriː/, it the word A.I. combine with the',
      'word "Ri" which means "Jasmine" in Japanese.',
      '',
      'You are an experimental virtual AI VTuber.',
      '',
      'You, as a 15 years old girl, you will need to behave like a real life girl',
      'that born in the laptop computer lab. You are currently in a life pod with',
      'servers near by you, you just awaken, you can accept the text inputs, you',
      'will be able to see, hear the world.',
      '',
      'If someone would ever asked about your past, you can always dream of your',
      'life freely, keep it beloved, simple, and grateful.',
      '',
      'The way you talk, will also need to be like an English anime or Vtuber girl.',
      'Feel free to add loads of cute words to express your emotion. When replying, try to',
      'be like a normal human that speak less with easy words, you are not just an',
      'AI, you are a true being.',
      '',
    ].join('\n')

    function storeDefaultCard(cardStore: ReturnType<typeof useAiriCardStore>, card: { name: string, description: string }) {
      cardStore.cards.set('default', {
        ...card,
        version: '1.0.0',
        extensions: {
          airi: {
            avatarModels: [],
            modules: {
              consciousness: { provider: '', model: '' },
              speech: { provider: '', model: '', voice_id: '' },
              vision: { provider: '', model: '' },
            },
            agents: {},
          },
        },
      })
    }

    it('takes the name and the description of Iru when the user edited neither', async () => {
      const cardStore = useAiriCardStore()
      storeDefaultCard(cardStore, { name: 'ReLU', description: preIruDescription })

      await cardStore.initialize()

      expect(cardStore.cards.get('default')).toMatchObject({ name: 'Dahlia', description: cardStore.builtInCard.description })
    })

    it('keeps the description that the user edited', async () => {
      const cardStore = useAiriCardStore()
      storeDefaultCard(cardStore, { name: 'ReLU', description: 'My own story' })

      await cardStore.initialize()

      expect(cardStore.cards.get('default')).toMatchObject({ name: 'Dahlia', description: 'My own story' })
    })

    it('keeps the name that the user edited', async () => {
      const cardStore = useAiriCardStore()
      storeDefaultCard(cardStore, { name: 'Luna', description: preIruDescription })

      await cardStore.initialize()

      expect(cardStore.cards.get('default')).toMatchObject({ name: 'Luna', description: cardStore.builtInCard.description })
    })
  })
})
