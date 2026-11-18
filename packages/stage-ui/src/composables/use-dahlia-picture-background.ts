import { useBackgroundStore } from '../stores/background'
import { useAiriCardStore } from '../stores/modules/airi-card'

/**
 * Dahlia: makes a picture she drew the stage background of the active character. The picture is copied into the
 * background gallery, so it stays when the hub forgets it.
 */
export function useDahliaPictureBackground() {
  const backgroundStore = useBackgroundStore()
  const cardStore = useAiriCardStore()

  /** Copies the picture at `url` (or the given bytes) into the gallery and selects it. Returns the gallery id. */
  async function setPictureAsBackground(source: string | Blob, title: string): Promise<string> {
    let blob: Blob
    if (typeof source === 'string') {
      const response = await fetch(source)
      if (!response.ok)
        throw new Error(`the picture could not be loaded (HTTP ${response.status})`)
      blob = await response.blob()
    }
    else {
      blob = source
    }

    const id = await backgroundStore.addBackground('scene', blob, title.trim() || 'Dahlia\'s picture')
    const cardId = cardStore.activeCardId
    const card = cardId ? cardStore.getCard(cardId) : undefined
    if (cardId && card) {
      await cardStore.updateCard(cardId, {
        ...card,
        extensions: {
          ...card.extensions,
          airi: {
            ...card.extensions?.airi,
            modules: {
              ...card.extensions?.airi?.modules,
              activeBackgroundId: id,
            },
          },
        },
      })
    }
    return id
  }

  return { setPictureAsBackground }
}
