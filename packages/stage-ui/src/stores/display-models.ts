import { createEventHook, until } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { displayModelsRepo } from '../database/repos/display-models.repo'

// Dahlia: VRM is the only model format; AIRI's Spine, Tachie and MMD renderers are not in the apps.
export enum DisplayModelFormat {
  VRM = 'vrm',
}

export type DisplayModel
  = | DisplayModelFile
    | DisplayModelURL

// Dahlia: her only avatar is her VRM, bundled with the app. The sample avatars aren't shipped.
const presetDahliaVrmUrl = new URL('../assets/vrm/models/dahlia/dahlia.vrm', import.meta.url).href

export interface DisplayModelFile {
  id: string
  format: DisplayModelFormat
  type: 'file'
  file: File
  name: string
  previewImage?: string
  importedAt: number
}

export interface DisplayModelURL {
  id: string
  format: DisplayModelFormat
  type: 'url'
  url: string
  name: string
  previewImage?: string
  importedAt: number
}

const displayModelsPresets: DisplayModel[] = [
  // Dahlia: her VRM is the only model; it can't be changed in the app.
  { id: 'preset-dahlia-vrm', format: DisplayModelFormat.VRM, type: 'url', url: presetDahliaVrmUrl, name: 'Dahlia', importedAt: 1733113886840 },
]

/**
 * The display models of this device: Dahlia's built-in VRM and any model stored on the device. The apps have no
 * AIRI account, so no model is kept in a cloud.
 */
export const useDisplayModelsStore = defineStore('display-models', () => {
  const displayModels = ref<DisplayModel[]>([])

  // Reports IDs that no longer exist on this device. The card store removes the references to reported IDs.
  const displayModelsDeleted = createEventHook<[deletedIds: string[]]>()
  /** Increases when the models of this device changed, so a model that could not load can be tried again. */
  const availabilityRevision = ref(0)

  let generateVrmPreview: (file: File) => Promise<string | undefined>

  const displayModelsFromIndexedDBLoading = ref(false)
  let displayModelsLoadPromise: Promise<void> | undefined

  function loadDisplayModelsFromIndexedDB() {
    if (!displayModelsLoadPromise) {
      displayModelsLoadPromise = (async () => {
        await until(displayModelsFromIndexedDBLoading).toBe(false)

        displayModelsFromIndexedDBLoading.value = true
        const models = [...displayModelsPresets]

        try {
          models.push(...await displayModelsRepo.list())
        }
        catch (err) {
          console.error(err)
        }

        displayModels.value = models.sort((a, b) => b.importedAt - a.importedAt)
        displayModelsFromIndexedDBLoading.value = false
      })().finally(() => {
        displayModelsLoadPromise = undefined
      })
    }

    return displayModelsLoadPromise
  }

  async function getDisplayModel(id: string) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    // NOTICE:
    // Newly imported file models are inserted into displayModels before callers pick them.
    // Reading memory first keeps updateStageModel from racing an IndexedDB write and treating
    // a just-imported display-model id as missing, which used to fall back to the default model.
    // Removal condition: custom model imports and selection are handled by a single transactional API.
    const modelFromMemory = displayModels.value.find(model => model.id === id)
    if (modelFromMemory)
      return modelFromMemory

    const modelFromFile = await displayModelsRepo.get(id)
    if (modelFromFile) {
      displayModels.value = [modelFromFile, ...displayModels.value].sort((a, b) => b.importedAt - a.importedAt)
      return modelFromFile
    }

    // Fallback to in-memory presets if not found in storage
    return displayModelsPresets.find(model => model.id === id)
  }

  const loadVrmModelPreview = (file: File) => generateVrmPreview(file)

  async function generatePreview(format: DisplayModelFormat, file: File): Promise<string | undefined> {
    if (format === DisplayModelFormat.VRM) {
      return loadVrmModelPreview(file)
    }
    return undefined
  }

  async function addDisplayModel(format: DisplayModelFormat, file: File) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    const newDisplayModel: DisplayModelFile = { id: `display-model-${nanoid()}`, format, type: 'file', file, name: file.name, importedAt: Date.now() }

    newDisplayModel.previewImage = await generatePreview(format, file)

    displayModels.value.unshift(newDisplayModel)

    // NOTICE:
    // Keep this awaited. A pick can call getDisplayModel immediately after import; fire-and-forget
    // persistence creates a race where the model exists in the UI but is not yet readable from IndexedDB.
    // Removal condition: imported display models are persisted through a transactional queue
    // that blocks pick/navigation until the write is durably complete.
    await displayModelsRepo.save(newDisplayModel)
      .catch(err => console.error(err))

    availabilityRevision.value++
    return newDisplayModel
  }

  async function renameDisplayModel(id: string, name: string) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    const displayModel = id.startsWith('display-model-')
      ? await displayModelsRepo.get(id)
      : displayModels.value.find(m => m.id === id)

    if (!displayModel)
      return

    displayModel.name = name

    // Update reactive state
    const index = displayModels.value.findIndex(m => m.id === id)
    if (index !== -1) {
      displayModels.value[index].name = name
    }

    if (displayModel.type !== 'file')
      return

    await displayModelsRepo.save(displayModel)
  }

  async function removeLocalCopy(id: string) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    await displayModelsRepo.remove(id)
    displayModels.value = displayModels.value.filter(model => model.id !== id)
  }

  /** Removes the model from this device. */
  async function removeDisplayModel(id: string) {
    await removeLocalCopy(id)
    availabilityRevision.value++
    await displayModelsDeleted.trigger([id])
  }

  async function resetDisplayModels() {
    await loadDisplayModelsFromIndexedDB()
    const userModels = displayModels.value.filter((model): model is DisplayModelFile => model.type === 'file')
    for (const model of userModels) {
      await removeLocalCopy(model.id)
    }

    displayModels.value = [...displayModelsPresets].sort((a, b) => b.importedAt - a.importedAt)
    availabilityRevision.value++
    if (userModels.length > 0)
      await displayModelsDeleted.trigger(userModels.map(model => model.id))
  }

  /** Resolves a model for rendering. Returns undefined when this device has no such model. */
  async function ensureDisplayModelAvailable(id: string) {
    return await getDisplayModel(id)
  }

  async function initialize() {
    const { loadVrmModelPreview } = await import('@proj-airi/stage-ui-three/utils/vrm-preview')
    generateVrmPreview = loadVrmModelPreview
  }

  return {
    displayModels,
    displayModelsFromIndexedDBLoading,
    availabilityRevision,

    initialize,
    loadDisplayModelsFromIndexedDB,
    getDisplayModel,
    ensureDisplayModelAvailable,
    addDisplayModel,
    renameDisplayModel,
    removeDisplayModel,
    resetDisplayModels,
    onDisplayModelsDeleted: displayModelsDeleted.on,
  }
})
