import type { Card, ccv3 } from '@proj-airi/ccc'

import type { CardModuleDefaults, CardProviderModule } from '../../services/airi-card-modules'
import type { AiriCard, AiriExtension } from '../../types/airiCard'
import type { CharacterAvatarModelReference } from '../../types/avatar-model'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { nanoid } from 'nanoid'
import { defineStore, getActivePinia } from 'pinia'
import { array, object, parse, parseJson, pipe, safeParse, string } from 'valibot'
import { computed, shallowRef, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'

import { DEFAULT_ARTISTRY_WIDGET_SPAWNING_PROMPT } from '../../constants/prompts/character-defaults'
import { captureAnalyticsEvent } from '../../libs/product-signals'
import { dahliaWakeWords } from '../../libs/voice/dahlia-wake-word'
import { wakeWordSchema } from '../../libs/voice/wake-words'
import { clearModuleSelections, resolveModuleSelection } from '../../services/airi-card-modules'
import { createAvatarModelReference } from '../../services/avatar-model'
import { normalizeContextWindow } from '../../types/airiCard'
import { withDahliaChat } from '../dahlia-chat'
import { useDisplayModelsStore } from '../display-models'
import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useSettingsStageModel } from '../settings/stage-model'
import { useArtistryStore } from './artistry'
import { useConsciousnessStore } from './consciousness'
import { useSpeechStore } from './speech'
import { useVisionStore } from './vision'

export type { AiriCard, AiriExtension } from '../../types/airiCard'

/**
 * SHA-256 of the built-in description in each language before the built-in character changed from ReLU to Iru.
 * A stored `default` card with one of these descriptions has no description edit, so `initialize` gives it the current text.
 * Each hash is of the text that `t('base.prompt.prefix')` returned. It differs from the raw message where the message has
 * literal interpolations such as `{'|'}`.
 */
const preIruBuiltInDescriptionHashes = new Set([
  '2a371f367e4330f4cec6b615ea6ea5e7d910d98dd5a14800a805f1c5d84d2ea5', // en
  '47db7cdf33e9e15f9f90f3343ee74207e840a772a7fabe4257d885f7496a7617', // es
  '1013da06f671c9e87fe5e68fbe196d53c30d3b2fcd50d8c7e90548482b9c5ae1', // fr
  '616be7ae1d5355326964f2b80bbade01b75c74738a0db1ef134e084bf93a4bf3', // ja
  '62487a8739eddca4d52e3c5be4aed3915040e49cb0c10a60905e9db4ace5d9e9', // ko
  'bf1bc35154aabe38048ad356485c451bf55d6964e7ec022c321a3d6a9244306e', // ru
  '8247a1cb7013a289a578f5e18e037f0d9bd9a38f607ddec838224769b5671aaa', // th
  '229ca59d6e5c49af637c8b870024de987645f56d02969bacb9d0b66e2267acdb', // vi
  '9df316e297f4cbac131c42eb79ab2177cd31232cb8f3229f47d9888ca80476a9', // zh-Hans
  '97cbaec5ee5ad2589a16499385ca61044c6e9f69d17adf435b14d73be6299e85', // zh-Hant
])

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const legacyModuleSelectionSchema = object({ provider: string(), model: string() })
const legacyModuleDefaultsJsonSchema = pipe(string(), parseJson(), object({
  consciousness: legacyModuleSelectionSchema,
  vision: legacyModuleSelectionSchema,
  speech: object({ provider: string(), model: string(), voice_id: string() }),
}))

/** Every device can load this Display Model, because it is bundled and not stored. */
const BUILT_IN_DISPLAY_MODEL_ID = 'preset-dahlia-vrm'
/** Global Stage model choice that versions before PR #2458 stored outside any card. */
const LEGACY_STAGE_MODEL_STORAGE_KEY = 'settings/stage/model'
const ACTIVE_CARD_ID_STORAGE_KEY = 'airi-card-active-id'
/** Snapshot of the module defaults that versions before the module stores held the defaults kept apart from them. */
const LEGACY_MODULE_DEFAULTS_STORAGE_KEY = 'airi-card-module-defaults'
const emptyAvatarModels: readonly CharacterAvatarModelReference[] = Object.freeze([])

/**
 * Returns the Display Model ID that a card stored before Avatar Models existed.
 *
 * Use it before `newAiriCard` normalizes the card, because normalization deletes
 * the old `modules.displayModelId` field.
 */
function legacyDisplayModelIdOf(card: AiriCard): string | undefined {
  const extension = card.extensions?.airi
  if (!extension?.modules || extension.avatarModels?.length)
    return undefined

  const value: unknown = Reflect.get(extension.modules, 'displayModelId')
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function resolveSystemPrompt(card: AiriCard | undefined): string {
  if (!card)
    return ''

  // Position-sensitive CCv3 fields are deliberately excluded until provider
  // message assembly owns their ordering and role semantics.
  const systemPromptParts = [
    // Dahlia: her persona comes from her server (SOUL.md), the same in Discord and the apps.
    card.extensions.airi.modules.artistry?.widgetInstruction,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)

  return systemPromptParts.join('\n\n')
}

function readPersistedActiveCardId(): string {
  try {
    return globalThis.localStorage?.getItem(ACTIVE_CARD_ID_STORAGE_KEY) || 'default'
  }
  catch {
    return 'default'
  }
}

function persistActiveCardId(id: string): boolean {
  try {
    globalThis.localStorage?.setItem(ACTIVE_CARD_ID_STORAGE_KEY, id)
    return true
  }
  catch {
    return false
  }
}

function clearPersistedActiveCardId(): boolean {
  try {
    globalThis.localStorage?.removeItem(ACTIVE_CARD_ID_STORAGE_KEY)
    return true
  }
  catch {
    return false
  }
}

export const useAiriCardStore = defineStore('airi-card', () => {
  // A watcher or an await runs outside the setup of this store. The active
  // Pinia can then be another one, so keep the Pinia that owns this store.
  const pinia = getActivePinia()
  const { t } = useI18n()
  const displayModels = useDisplayModelsStore()

  const cards = useLocalStorageManualReset<Map<string, AiriCard>>('airi-cards', new Map(), { listenToStorageChanges: false })
  const activeCardId = shallowRef(readPersistedActiveCardId())
  // The active Avatar Model is runtime state. Pinia replicates it between
  // windows, but the Character configuration remains its only durable owner.
  const selectedAvatarModelId = shallowRef<string>()
  let initialized = false
  /** True after `initialize` applied the active card. Before that, no card owns the Stage. */
  const ready = shallowRef(false)

  let pendingModuleDefaults: Promise<void> | undefined

  const activeCard = computed(() => cards.value.get(activeCardId.value))
  const activeAvatarModels = computed(() => activeCard.value?.extensions.airi.avatarModels ?? emptyAvatarModels)
  const selectedAvatarModel = computed(() => activeAvatarModels.value.find(model => model.id === selectedAvatarModelId.value))

  function resolveDefaultAvatarModelId(card = activeCard.value) {
    const defaultAvatarModelId = card?.extensions.airi.defaultAvatarModelId
    if (!defaultAvatarModelId)
      return

    return card.extensions.airi.avatarModels.some(model => model.id === defaultAvatarModelId)
      ? defaultAvatarModelId
      : undefined
  }

  function useRuntimeModuleStores() {
    return {
      artistry: useArtistryStore(pinia),
      consciousness: useConsciousnessStore(pinia),
      speech: useSpeechStore(pinia),
      vision: useVisionStore(pinia),
    }
  }

  /**
   * Reads the global defaults of the modules.
   *
   * The module stores hold the defaults and nothing else. A character holds its own values on its card,
   * and {@link getModules} resolves the two. The activation of a character does not write the module stores.
   */
  function readModuleDefaults(): CardModuleDefaults {
    const { consciousness, vision, speech } = useRuntimeModuleStores()
    return {
      consciousness: { provider: consciousness.activeProvider, model: consciousness.activeModel },
      vision: { provider: vision.activeProvider, model: vision.activeModel },
      speech: { provider: speech.activeSpeechProvider, model: speech.activeSpeechModel, voice_id: speech.activeSpeechVoiceId },
    }
  }

  /** Writes the defaults. Speech goes through the leader command, so catalog invalidation precedes its saved voice. */
  async function writeModuleDefaults(modules: CardModuleDefaults) {
    const { consciousness, vision, speech } = useRuntimeModuleStores()
    // Provider changes synchronously clear dependent selections. Assign the
    // resolved model and voice afterwards, including empty values.
    consciousness.activeProvider = modules.consciousness.provider
    consciousness.activeModel = modules.consciousness.model
    // The vision store keeps a custom model name per selection. It does not clear that name when the provider changes.
    if (vision.activeProvider !== modules.vision.provider)
      vision.resetModelSelection()
    vision.activeProvider = modules.vision.provider
    vision.activeModel = modules.vision.model
    await speech.selectProviderModel(modules.speech.provider, modules.speech.model, modules.speech.voice_id)
  }

  /**
   * Prepares the module defaults at startup, without changing any card's stored overrides.
   * The synchronization leader runs it before any read or write of the defaults.
   */
  async function prepareModuleDefaults() {
    const previous = pendingModuleDefaults
    const operation = (async () => {
      // A failed run is reported to its caller. The next run must still go ahead.
      if (previous)
        await previous.catch(() => {})
      await migrateLegacyModuleDefaults()
    })()
    pendingModuleDefaults = operation
    try {
      await operation
    }
    finally {
      if (pendingModuleDefaults === operation)
        pendingModuleDefaults = undefined
    }
  }

  /**
   * Moves the defaults of an earlier version into the module stores, one time.
   *
   * Call it in the synchronization leader before any read or write of the defaults.
   */
  async function migrateLegacyModuleDefaults() {
    // NOTICE:
    // Versions before this change kept the defaults in a `localStorage` snapshot. The module stores then held
    // the resolved selection of the active character, which can be a value of that character.
    // Without this step, the value of the active character becomes the default of every character.
    // See docs/ai/adr/2026-11-11-module-defaults-and-character-values.md, "Data of existing installations".
    // Remove this function when no supported version writes `airi-card-module-defaults`.
    //
    // Read the key at each call and keep no copy. Another window can complete the migration and remove the key.
    // A window with a copy from its start repeats the migration when it becomes the leader, and replaces
    // the defaults that the user changed after the first migration.
    // A runtime without `localStorage` has no data of an earlier version.
    const stored = globalThis.localStorage?.getItem(LEGACY_MODULE_DEFAULTS_STORAGE_KEY)
    if (stored == null)
      return
    // Remove the key before the write yields, so a second call in this window finds nothing.
    globalThis.localStorage.removeItem(LEGACY_MODULE_DEFAULTS_STORAGE_KEY)
    const defaults = safeParse(legacyModuleDefaultsJsonSchema, stored)
    // An unreadable snapshot gives no defaults to move. The module stores keep their values.
    if (defaults.success)
      await writeModuleDefaults(defaults.output)
  }

  /**
   * `source` feeds the `card_created` analytics event: `scratch` = built in
   * the creation dialog, `import` = ccv3 JSON upload, `duplicate` = cloned
   * from an existing card (profile switcher). Required so a new call site
   * can't silently degrade creation attribution.
   */
  const addCard = async (card: AiriCard | Card | ccv3.CharacterCardV3, source: 'scratch' | 'import' | 'duplicate', displayModelId?: string) => {
    const newCardId = nanoid()
    const newCard = newAiriCard(toRaw(card))
    cards.value.set(newCardId, newCard)

    if (displayModelId)
      await setCharacterDefaultAvatarModelFromDisplayModel(newCardId, displayModelId)

    captureAnalyticsEvent('card_created', { card_id: newCardId, source })
    return newCardId
  }

  const removeCard = async (id: string) => {
    await pendingModuleDefaults
    // The built-in card is the guaranteed fallback for every runtime profile.
    if (id === 'default')
      return false

    const removed = cards.value.delete(id)
    if (!removed)
      return false

    // The active id is persisted independently from the card map. Reset it
    // before consumers observe a dangling runtime profile after deletion.
    if (activeCardId.value === id) {
      activeCardId.value = 'default'
      persistActiveCardId(activeCardId.value)
      selectedAvatarModelId.value = resolveDefaultAvatarModelId()
      await applyActiveCardSettings()
    }

    captureAnalyticsEvent('character_deleted', { character_id: id })
    return true
  }

  const updateCard = async (id: string, updates: AiriCard | Card | ccv3.CharacterCardV3, displayModelId?: string) => {
    await pendingModuleDefaults
    const existingCard = toRaw(cards.value.get(id))
    if (!existingCard)
      return false

    const updatedCard = {
      ...existingCard,
      ...updates,
    }

    const card = newAiriCard(updatedCard)
    cards.value.set(id, card)
    let editedAvatarModelId: string | undefined
    if (displayModelId !== undefined)
      editedAvatarModelId = await setCharacterDefaultAvatarModelFromDisplayModel(id, displayModelId)

    if (id === activeCardId.value) {
      if (displayModelId !== undefined)
        selectedAvatarModelId.value = editedAvatarModelId
      await applyActiveCardSettings()
    }

    return true
  }

  const getCard = (id: string) => {
    return cards.value.get(id)
  }

  async function ensureAvatarModel(characterId: string, displayModelId: string) {
    const card = toRaw(cards.value.get(characterId))
    if (!card)
      return

    const existing = card.extensions.airi.avatarModels.find(model => model.displayModelId === displayModelId)
    if (existing)
      return existing.id

    const displayModel = await displayModels.getDisplayModel(displayModelId)
    if (!displayModel)
      return

    const avatarModel = createAvatarModelReference(displayModelId, displayModel.format)
    cards.value.set(characterId, {
      ...card,
      extensions: {
        ...card.extensions,
        airi: {
          ...card.extensions.airi,
          avatarModels: [...card.extensions.airi.avatarModels, avatarModel],
        },
      },
    })

    return avatarModel.id
  }

  function setCharacterDefaultAvatarModel(characterId: string, avatarModelId: string | undefined) {
    const card = toRaw(cards.value.get(characterId))
    if (!card)
      return false

    const avatarModel = avatarModelId
      ? card.extensions.airi.avatarModels.find(model => model.id === avatarModelId)
      : undefined
    if (avatarModelId && !avatarModel)
      return false

    cards.value.set(characterId, {
      ...card,
      extensions: {
        ...card.extensions,
        airi: {
          ...card.extensions.airi,
          defaultAvatarModelId: avatarModelId,
        },
      },
    })

    return true
  }

  async function setCharacterDefaultAvatarModelFromDisplayModel(characterId: string, displayModelId: string) {
    const avatarModelId = displayModelId
      ? await ensureAvatarModel(characterId, displayModelId)
      : undefined
    if (displayModelId && !avatarModelId)
      return

    setCharacterDefaultAvatarModel(characterId, avatarModelId)
    return avatarModelId
  }

  async function setActiveCardDefaultAvatarModel(displayModelId: string | undefined) {
    await pendingModuleDefaults
    const avatarModelId = await setCharacterDefaultAvatarModelFromDisplayModel(activeCardId.value, displayModelId ?? '')
    if (displayModelId && !avatarModelId)
      return false

    return selectAvatarModel(avatarModelId)
  }

  /**
   * Removes the references to deleted Display Models from every Character and
   * selects an available default.
   *
   * Only the deleted IDs are removed. A synchronized card can reference a
   * Display Model that only another device stores. That reference must stay,
   * or the removal syncs to that device and deletes its link to the model.
   */
  async function removeDeletedAvatarModels(deletedDisplayModelIds: readonly string[], availableDisplayModelIds: readonly string[]) {
    const deleted = new Set(deletedDisplayModelIds)
    for (const [characterId, storedCard] of cards.value) {
      const card = toRaw(storedCard)
      const extension = card.extensions.airi
      const avatarModels = extension.avatarModels.filter(model => !deleted.has(model.displayModelId))
      if (avatarModels.length === extension.avatarModels.length)
        continue

      let defaultAvatarModelId = extension.defaultAvatarModelId
      if (defaultAvatarModelId && !avatarModels.some(model => model.id === defaultAvatarModelId)) {
        let fallback = avatarModels.find(model => model.displayModelId === BUILT_IN_DISPLAY_MODEL_ID) ?? avatarModels[0]
        if (!fallback) {
          for (const displayModelId of availableDisplayModelIds) {
            const displayModel = await displayModels.getDisplayModel(displayModelId)
            if (!displayModel)
              continue

            fallback = createAvatarModelReference(displayModel.id, displayModel.format)
            avatarModels.push(fallback)
            break
          }
        }
        defaultAvatarModelId = fallback?.id
      }

      cards.value.set(characterId, {
        ...card,
        extensions: {
          ...card.extensions,
          airi: { ...extension, avatarModels, defaultAvatarModelId },
        },
      })
    }

    if (!activeAvatarModels.value.some(model => model.id === selectedAvatarModelId.value)) {
      selectedAvatarModelId.value = resolveDefaultAvatarModelId()
      await applyActiveAvatarModel()
    }
  }

  // The display model store of each window reports the deletions that the window makes.
  // Call through the store, so the synchronized action runs in the leader.
  displayModels.onDisplayModelsDeleted(async (ids) => {
    await useAiriCardStore(pinia).removeDeletedAvatarModels(ids, displayModels.displayModels.map(model => model.id))
  })

  /** Clears matching selections from the defaults and from every card. */
  async function clearModuleProviders(modules: readonly CardProviderModule[], shouldClear: (providerId: string) => boolean) {
    await pendingModuleDefaults
    await migrateLegacyModuleDefaults()
    const defaults = readModuleDefaults()
    for (const [id, storedCard] of cards.value) {
      const card = toRaw(storedCard)
      const extension = card.extensions.airi
      const next = clearModuleSelections(extension.modules, modules, shouldClear, defaults)
      if (next === extension.modules)
        continue
      cards.value.set(id, { ...card, extensions: { ...card.extensions, airi: { ...extension, modules: next } } })
    }

    const nextDefaults = clearModuleSelections(defaults, modules, shouldClear)
    if (nextDefaults !== defaults)
      await writeModuleDefaults(nextDefaults)
  }

  /** Clears a deleted provider from defaults and every card. */
  async function clearProviderSelections(providerId: string) {
    await clearModuleProviders(['consciousness', 'vision', 'speech'], id => id === providerId)
  }

  /** Clears vision and speech selections whose provider lost its settings in a reset. Consciousness stays unchanged. */
  async function clearUnavailableProviderSelections() {
    const providers = useProviderStore(pinia)
    await clearModuleProviders(['vision', 'speech'], id => !providers.isProviderAvailableWithoutConfiguration(id))
  }

  function resolveAiriExtension(card: Card | ccv3.CharacterCardV3): AiriExtension {
    // Get existing extension if available
    const existingExtension = ('data' in card
      ? card.data?.extensions?.airi
      : card.extensions?.airi) as AiriExtension

    // Create default modules config
    const defaultModules = {
      consciousness: { provider: '', model: '' },
      vision: { provider: '', model: '' },
      speech: { provider: '', model: '', voice_id: '' },
      artistry: {
        enabled: false,
        provider: '',
        model: '',
        promptPrefix: '',
        widgetInstruction: DEFAULT_ARTISTRY_WIDGET_SPAWNING_PROMPT,
        spawnMode: 'bg_widget' as const,
        options: undefined,
        autonomousEnabled: false,
        autonomousThreshold: 70,
        autonomousTarget: 'assistant' as const,
      },
    } as const

    // Return default if no extension exists
    if (!existingExtension) {
      return {
        contextWindow: -1,
        avatarModels: [],
        modules: defaultModules,
        agents: {},
      }
    }

    const avatarModels = existingExtension.avatarModels
      ? [...existingExtension.avatarModels]
      : []
    const defaultAvatarModelId = existingExtension.defaultAvatarModelId
    const hasDefaultAvatarModel = avatarModels.some(model => model.id === defaultAvatarModelId)
    const existingModules = { ...existingExtension.modules }
    Reflect.deleteProperty(existingModules, 'displayModelId')

    // Fill known fields without discarding settings owned by imported extensions.
    return {
      ...existingExtension,
      contextWindow: normalizeContextWindow(existingExtension.contextWindow),
      ...(existingExtension.wakeWords === undefined ? {} : { wakeWords: parse(array(wakeWordSchema), existingExtension.wakeWords) }),
      avatarModels,
      defaultAvatarModelId: hasDefaultAvatarModel ? defaultAvatarModelId : undefined,
      modules: {
        ...existingModules,
        consciousness: {
          ...existingExtension.modules?.consciousness,
          provider: existingExtension.modules?.consciousness?.provider ?? defaultModules.consciousness.provider,
          model: existingExtension.modules?.consciousness?.model ?? defaultModules.consciousness.model,
        },
        vision: {
          ...existingExtension.modules?.vision,
          provider: existingExtension.modules?.vision?.provider ?? defaultModules.vision.provider,
          model: existingExtension.modules?.vision?.model ?? defaultModules.vision.model,
        },
        speech: {
          ...existingExtension.modules?.speech,
          provider: existingExtension.modules?.speech?.provider ?? defaultModules.speech.provider,
          model: existingExtension.modules?.speech?.model ?? defaultModules.speech.model,
          voice_id: existingExtension.modules?.speech?.voice_id ?? defaultModules.speech.voice_id,
          pitch: existingExtension.modules?.speech?.pitch,
          rate: existingExtension.modules?.speech?.rate,
          ssml: existingExtension.modules?.speech?.ssml,
          language: existingExtension.modules?.speech?.language,
        },
        vrm: existingExtension.modules?.vrm,
        activeBackgroundId: existingExtension.modules?.activeBackgroundId,
        artistry: {
          ...existingExtension.modules?.artistry,
          enabled: existingExtension.modules?.artistry?.enabled ?? (existingExtension as any).artistry?.enabled ?? defaultModules.artistry.enabled,
          provider: existingExtension.modules?.artistry?.provider ?? (existingExtension as any).artistry?.provider ?? defaultModules.artistry.provider,
          model: existingExtension.modules?.artistry?.model ?? (existingExtension as any).artistry?.model ?? defaultModules.artistry.model,
          promptPrefix: existingExtension.modules?.artistry?.promptPrefix ?? (existingExtension as any).artistry?.promptPrefix ?? (existingExtension as any).artistry?.prompt_prefix ?? defaultModules.artistry.promptPrefix,
          workflowId: existingExtension.modules?.artistry?.workflowId ?? (existingExtension as any).artistry?.workflowId ?? (existingExtension as any).artistry?.remixId,
          widgetInstruction: existingExtension.modules?.artistry?.widgetInstruction ?? (existingExtension as any).artistry?.widgetInstruction ?? defaultModules.artistry.widgetInstruction,
          spawnMode: existingExtension.modules?.artistry?.spawnMode ?? (existingExtension as any).artistry?.spawnMode ?? defaultModules.artistry.spawnMode,
          options: existingExtension.modules?.artistry?.options ?? (existingExtension as any).artistry?.options ?? defaultModules.artistry.options,
          autonomousEnabled: existingExtension.modules?.artistry?.autonomousEnabled ?? (existingExtension as any).artistry?.autonomousEnabled ?? defaultModules.artistry.autonomousEnabled,
          autonomousThreshold: existingExtension.modules?.artistry?.autonomousThreshold ?? (existingExtension as any).artistry?.autonomousThreshold ?? defaultModules.artistry.autonomousThreshold,
          autonomousTarget: existingExtension.modules?.artistry?.autonomousTarget ?? (existingExtension as any).artistry?.autonomousTarget ?? defaultModules.artistry.autonomousTarget,
        },
      },
      agents: existingExtension.agents ?? {},
    }
  }

  function newAiriCard(card: Card | ccv3.CharacterCardV3): AiriCard {
    // Handle ccv3 format if needed
    if ('data' in card) {
      const ccv3Card = card as ccv3.CharacterCardV3
      return {
        name: ccv3Card.data.name,
        version: ccv3Card.data.character_version ?? '1.0.0',
        description: ccv3Card.data.description ?? '',
        creator: ccv3Card.data.creator ?? '',
        notes: ccv3Card.data.creator_notes ?? '',
        notesMultilingual: ccv3Card.data.creator_notes_multilingual,
        personality: ccv3Card.data.personality ?? '',
        scenario: ccv3Card.data.scenario ?? '',
        greetings: [
          ccv3Card.data.first_mes,
          ...(ccv3Card.data.alternate_greetings ?? []),
        ],
        greetingsGroupOnly: ccv3Card.data.group_only_greetings ?? [],
        systemPrompt: ccv3Card.data.system_prompt ?? '',
        postHistoryInstructions: ccv3Card.data.post_history_instructions ?? '',
        messageExample: ccv3Card.data.mes_example
          ? ccv3Card.data.mes_example
              .split('<START>\n')
              .filter(Boolean)
              .map(example => example.split('\n')
                .map((line) => {
                  if (line.startsWith('{{char}}:') || line.startsWith('{{user}}:'))
                    return line as `{{char}}: ${string}` | `{{user}}: ${string}`
                  throw new Error(`Invalid message example format: ${line}`)
                }))
          : [],
        tags: ccv3Card.data.tags ?? [],
        extensions: {
          ...ccv3Card.data.extensions,
          airi: resolveAiriExtension(ccv3Card),
        },
      }
    }

    return {
      ...card,
      extensions: {
        ...card.extensions,
        airi: resolveAiriExtension(card),
      },
    }
  }

  /** The `default` card before the user edits it. */
  const builtInCard = computed(() => newAiriCard({
    name: 'Dahlia',
    version: '1.0.0',
    description: t('base.prompt.prefix'),
    extensions: {
      airi: {
        // Every device ships the preset model, so this reference is part of the built-in content.
        defaultAvatarModelId: 'default-vrm-avatar-model',
        avatarModels: [{
          id: 'default-vrm-avatar-model',
          displayModelId: 'preset-dahlia-vrm',
          type: 'vrm',
          config: {},
        }],
        modules: {
          consciousness: { provider: '', model: '' },
          speech: { provider: '', model: '', voice_id: '' },
          vision: { provider: '', model: '' },
        },
        agents: {},
        // Dahlia: her name is the wake word that starts a voice input.
        wakeWords: structuredClone(dahliaWakeWords),
      },
    },
  }))

  // NOTICE:
  // The stored `default` card is a copy of the built-in ReLU card.
  // Give it the name and the description of Iru, except the parts that the user edited.
  // Source: https://github.com/moeru-ai/airi/pull/3287
  // Removal condition: two stable releases after the release in which every locale names Iru.
  /** Runs in the leader at the end of `initialize`. A second call changes nothing. */
  async function migratePreIruCard() {
    const description = cards.value.get('default')?.description ?? ''
    const builtInDescription = preIruBuiltInDescriptionHashes.has(await sha256Hex(description))
    // Read the card again after the digest, so the write keeps a change made meanwhile.
    const card = toRaw(cards.value.get('default'))
    if (!card)
      return

    const renamed = card.name === 'ReLU'
    const describedBuiltIn = builtInDescription && (card.description ?? '') === description
    if (!renamed && !describedBuiltIn)
      return

    cards.value.set('default', {
      ...card,
      name: renamed ? builtInCard.value.name : card.name,
      description: describedBuiltIn ? builtInCard.value.description : card.description,
    })
  }

  /** Applies the initial card while preserving setup context when no default preparation is pending. */
  async function initialize() {
    // Awaiting undefined would leave component setup before the first runtime
    // stores bind i18n. A running preparation already owns those stores.
    if (pendingModuleDefaults)
      await pendingModuleDefaults
    // This synchronized action executes in the leader. Each window calls it,
    // but only the first call migrates stored data and applies the active card.
    if (initialized)
      return

    initialized = true
    // The leader must hold the module stores. A follower window sends its selections and
    // action requests to the leader, and a request for a store that the leader lacks fails.
    useRuntimeModuleStores()
    await migrateLegacyModuleDefaults()
    // NOTICE:
    // Cards saved before Avatar Models store their model in `modules.displayModelId`.
    // Normalization deletes it, so move it into an Avatar Model reference first.
    // Source: PR #2458 replaced `modules.displayModelId` with `avatarModels`.
    // Removal condition: one stable release after the first stable release with PR #2458.
    const legacyDisplayModelIds = new Map<string, string>()
    for (const [id, card] of cards.value) {
      const legacyDisplayModelId = legacyDisplayModelIdOf(toRaw(card))
      // The built-in card keeps its built-in reference for the bundled preset.
      // The backfill below adds it, so an unedited built-in card syncs no fields.
      if (legacyDisplayModelId && (id !== 'default' || legacyDisplayModelId !== BUILT_IN_DISPLAY_MODEL_ID))
        legacyDisplayModelIds.set(id, legacyDisplayModelId)

      const normalizedCard = newAiriCard(toRaw(card))
      cards.value.set(id, normalizedCard)
    }
    // A model that this device does not store gives no reference. The Stage then
    // asks the user to select a model.
    for (const [id, displayModelId] of legacyDisplayModelIds)
      await setCharacterDefaultAvatarModelFromDisplayModel(id, displayModelId)

    if (!cards.value.has('default'))
      cards.value.set('default', structuredClone(toRaw(builtInCard.value)))
    // Dahlia: the built-in card is Dahlia, also on installs that stored the old name ReLU.
    const storedDefault = toRaw(cards.value.get('default'))
    if (storedDefault?.name === 'ReLU')
      cards.value.set('default', { ...storedDefault, name: 'Dahlia' })
    // Dahlia: her name is the wake word of the built-in card, also on installs that stored the card before it had one.
    const cardWithoutWakeWords = toRaw(cards.value.get('default'))
    if (cardWithoutWakeWords && cardWithoutWakeWords.extensions.airi.wakeWords === undefined) {
      cards.value.set('default', {
        ...cardWithoutWakeWords,
        extensions: { ...cardWithoutWakeWords.extensions, airi: { ...cardWithoutWakeWords.extensions.airi, wakeWords: structuredClone(dahliaWakeWords) } },
      })
    }

    // Stored speech-noop can mean an intentional mute. Only the editor may
    // replace it with inheritance; the old placeholder has no provenance marker.
    // The active id and card map are persisted separately. Older versions
    // could delete the selected card without repairing its stored id.
    if (!cards.value.has(activeCardId.value))
      activeCardId.value = 'default'
    persistActiveCardId(activeCardId.value)

    // NOTICE:
    // The built-in card stored before PR #2458 has no Avatar Model. Give it the
    // bundled preset when the migration above found no model for it.
    // Removal condition: the same as the migration above.
    const defaultCard = toRaw(cards.value.get('default'))
    if (defaultCard && defaultCard.extensions.airi.avatarModels.length === 0) {
      cards.value.set('default', {
        ...defaultCard,
        extensions: {
          ...defaultCard.extensions,
          airi: {
            ...defaultCard.extensions.airi,
            defaultAvatarModelId: builtInCard.value.extensions.airi.defaultAvatarModelId,
            avatarModels: structuredClone(toRaw(builtInCard.value.extensions.airi.avatarModels)),
          },
        },
      })
    }

    // NOTICE:
    // Up to v0.12.0-beta.5 the Stage model was also stored in `settings/stage/model`.
    // PR #2458 stopped reading it, so an upgrade showed the bundled preset.
    // Move it once, only into a card that shows the bundled preset.
    // Removal condition: the same as the migration above.
    const legacyStageModelId = globalThis.localStorage?.getItem(LEGACY_STAGE_MODEL_STORAGE_KEY)
    if (legacyStageModelId) {
      const card = toRaw(cards.value.get(activeCardId.value))
      const cardDefaultAvatarModelId = card?.extensions.airi.defaultAvatarModelId
      const cardDisplayModelId = card?.extensions.airi.avatarModels.find(model => model.id === cardDefaultAvatarModelId)?.displayModelId
      if (legacyStageModelId !== BUILT_IN_DISPLAY_MODEL_ID && (!cardDisplayModelId || cardDisplayModelId === BUILT_IN_DISPLAY_MODEL_ID))
        await setCharacterDefaultAvatarModelFromDisplayModel(activeCardId.value, legacyStageModelId)
      // A model that this device does not store gives no reference, as above.
      // Remove the key in all cases, so that the migration runs only once.
      localStorage.removeItem(LEGACY_STAGE_MODEL_STORAGE_KEY)
    }

    if (!activeAvatarModels.value.some(model => model.id === selectedAvatarModelId.value))
      selectedAvatarModelId.value = resolveDefaultAvatarModelId()

    await applyActiveCardSettings()

    await migratePreIruCard()

    ready.value = true
  }

  /**
   * Selects a card and applies its module settings in the synchronization
   * leader. Replicated state snapshots never invoke this command.
   */
  async function activateCard(id: string) {
    await pendingModuleDefaults
    if (!cards.value.has(id))
      return false

    activeCardId.value = id
    persistActiveCardId(id)
    selectedAvatarModelId.value = resolveDefaultAvatarModelId()
    await applyActiveCardSettings()
    return true
  }

  async function selectAvatarModel(id: string | undefined) {
    if (id && !activeAvatarModels.value.some(model => model.id === id))
      return false

    selectedAvatarModelId.value = id
    await applyActiveAvatarModel()
    return true
  }

  async function applyActiveAvatarModel() {
    // Dahlia ships exactly one avatar (her VRM) and the Models page is hidden, so the stage always shows
    // her built-in model. A card persisted or synced from an older build can still point at a display model
    // this build removed; using the built-in id keeps the stage from going blank on "model not on this device".
    useSettingsStageModel(pinia).stageModelSelected = BUILT_IN_DISPLAY_MODEL_ID
  }

  /**
   * Resolves the modules of the named character without changing the character selected by any window.
   *
   * Each module resolves when the caller reads it, and reads only its own module store.
   * A chat turn reads `consciousness` in a window that has no speech store, and the speech store needs a component setup to start.
   */
  function getModules(characterId: string): CardModuleDefaults {
    const card = cards.value.get(characterId)
    if (!card)
      throw new Error('The session character is unavailable')
    const modules = card.extensions.airi.modules
    return {
      get consciousness() {
        const store = useConsciousnessStore(pinia)
        return resolveChatModule(modules.consciousness, { provider: store.activeProvider, model: store.activeModel })
      },
      get vision() {
        const store = useVisionStore(pinia)
        return resolveChatModule(modules.vision, { provider: store.activeProvider, model: store.activeModel })
      },
      get speech() {
        const store = useSpeechStore(pinia)
        return resolveSpeechModule(modules.speech, { provider: store.activeSpeechProvider, model: store.activeSpeechModel, voice_id: store.activeSpeechVoiceId })
      },
    }
  }

  /**
   * A provider that AIRI's sign-in configured in an earlier version, such as AIRI's official providers, can stay in
   * the saved settings, unconfigured. A card that still names one resolves to no selection.
   */
  function isSignedOutProvider(providerId: string) {
    const provider = useProviderConfigStore(pinia).providers[providerId]
    return provider?.configuredBy === 'authentication' && provider.status === 'unconfigured'
  }

  function resolveChatModule(own: CardModuleDefaults['consciousness'], fallback: CardModuleDefaults['consciousness']): CardModuleDefaults['consciousness'] {
    const selection = resolveModuleSelection(own, fallback)
    return isSignedOutProvider(selection.provider) ? { provider: '', model: '' } : selection
  }

  function resolveSpeechModule(own: AiriExtension['modules']['speech'], fallback: CardModuleDefaults['speech']): CardModuleDefaults['speech'] {
    const selection = resolveModuleSelection(own, fallback)
    if (isSignedOutProvider(selection.provider))
      return { provider: 'speech-noop', model: '', voice_id: '' }

    // A voice belongs to one provider and model, so the default voice applies only to the default provider and model.
    const inheritsVoice = selection.provider === fallback.provider && selection.model === fallback.model
    return { ...selection, voice_id: own.voice_id || (inheritsVoice ? fallback.voice_id : '') }
  }

  function resolveModules(modules: AiriExtension['modules'], defaults: CardModuleDefaults): CardModuleDefaults {
    return {
      consciousness: withDahliaChat(resolveChatModule(modules.consciousness, defaults.consciousness)),
      vision: resolveChatModule(modules.vision, defaults.vision),
      speech: resolveSpeechModule(modules.speech, defaults.speech),
    }
  }

  /**
   * The module selections of every character, resolved against the defaults, by character id.
   * A chat session resolves its own character through `getModules`, so a provider can be in use without the active card.
   * The settings home reads it to find the providers in use, and the characters that cannot speak.
   */
  const characterModules = computed<ReadonlyMap<string, CardModuleDefaults>>(() => {
    const defaults = readModuleDefaults()
    return new Map([...cards.value].map(([id, card]) => [id, resolveModules(card.extensions.airi.modules, defaults)]))
  })

  function getSystemPrompt(characterId: string) {
    return resolveSystemPrompt(cards.value.get(characterId))
  }

  /**
   * Applies the parts of the active card that a window-wide store still holds: the display model and artistry.
   * It does not write the consciousness, vision, and speech stores. They hold the global defaults.
   */
  async function applyActiveCardSettings(newCard = activeCard.value) {
    const artistry = useArtistryStore(pinia)

    artistry.resetToGlobal()

    if (!newCard)
      return

    // TODO: Minecraft Agent, etc
    const extension = resolveAiriExtension(newCard)
    if (!extension)
      return

    await applyActiveAvatarModel()

    if (extension.modules?.artistry) {
      const selection = resolveModuleSelection({
        provider: extension.modules.artistry.provider ?? '',
        model: extension.modules.artistry.model ?? '',
      }, { provider: artistry.globalProvider, model: artistry.globalModel })
      artistry.activeProvider = selection.provider
      artistry.activeModel = selection.model
      if (selection.provider !== artistry.globalProvider)
        artistry.providerOptions = undefined
      if (extension.modules.artistry.promptPrefix)
        artistry.defaultPromptPrefix = extension.modules.artistry.promptPrefix
      if (extension.modules.artistry.options)
        artistry.providerOptions = extension.modules.artistry.options
    }
  }

  function resetState() {
    initialized = false
    ready.value = false
    globalThis.localStorage?.removeItem(LEGACY_MODULE_DEFAULTS_STORAGE_KEY)
    cards.reset()
    activeCardId.value = 'default'
    selectedAvatarModelId.value = undefined
    clearPersistedActiveCardId()
  }

  return {
    cards,
    /** The global defaults of the modules, read from the module stores. */
    moduleDefaults: computed(readModuleDefaults),
    characterModules,
    activeCard,
    activeCardId,
    builtInCard,
    ready,
    selectedAvatarModel,
    selectedAvatarModelId,
    addCard,
    removeCard,
    updateCard,
    setActiveCardDefaultAvatarModel,
    removeDeletedAvatarModels,
    getCard,
    getModules,
    getSystemPrompt,
    resetState,
    selectAvatarModel,
    initialize,
    activateCard,
    prepareModuleDefaults,
    clearProviderSelections,
    clearUnavailableProviderSelections,

    systemPrompt: computed(() => resolveSystemPrompt(activeCard.value)),
  }
}, {
  synced: {
    actions: [
      'activateCard',
      'addCard',
      'initialize',
      'prepareModuleDefaults',
      'clearProviderSelections',
      'clearUnavailableProviderSelections',
      'removeCard',
      'selectAvatarModel',
      'setActiveCardDefaultAvatarModel',
      'removeDeletedAvatarModels',
      'updateCard',
    ],
    state: true,
  },
})
