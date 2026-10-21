import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAiriCardStore } from './airi-card'
import { useSpeechStore } from './speech'

const { resetArtistryToGlobal } = vi.hoisted(() => ({
  resetArtistryToGlobal: vi.fn(),
}))

// NOTICE:
// Vitest runs these store tests in Node, where localforage cannot select a
// browser storage driver. The stage-model watcher legitimately asks the
// display-model store to resolve IDs, so provide the storage boundary with a
// deterministic no-op instead of allowing rejected driver initialization to
// escape as an unrelated test error.
vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn(async () => undefined),
    iterate: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    setItem: vi.fn(async <T>(_: string, value: T) => value),
  },
}))

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

// Dahlia: the store changes that scripts/apply_avatar_branding.sh makes. This file is Dahlia's (AIRI has
// no such file). Her persona comes from her server, so a card adds no character text to the chat.
describe('airi-card store in Dahlia', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetArtistryToGlobal.mockClear()
    useSpeechStore().$patch({
      activeSpeechProvider: 'mock-speech-provider',
      activeSpeechModel: 'mock-speech-model',
      activeSpeechVoiceId: 'mock-speech-voice',
    })
  })

  it('sends no character text of a card, only the stage instructions', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Runtime context card',
      version: '1.0.0',
      systemPrompt: 'Follow the character rules.',
      description: 'A patient field researcher.',
      personality: 'Curious and precise.',
      scenario: 'The conversation takes place in an observatory.',
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

    expect(cardStore.systemPrompt).toBe('Use the image widget for star charts.')
  })

  it('sends no text of the built-in card', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    expect(cardStore.activeCardId).toBe('default')
    expect(cardStore.systemPrompt).not.toContain('base.prompt.prefix')
  })

  it('names the built-in card Dahlia', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    expect(cardStore.activeCard?.name).toBe('Dahlia')
  })

  it('renames a built-in card stored with the old name ReLU', async () => {
    const cardStore = useAiriCardStore()
    cardStore.cards.set('default', { ...structuredClone(cardStore.builtInCard), name: 'ReLU' })

    await cardStore.initialize()

    expect(cardStore.cards.get('default')?.name).toBe('Dahlia')
  })
})
