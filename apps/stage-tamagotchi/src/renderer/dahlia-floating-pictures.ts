// Dahlia: her drawings float on the desktop. When a reply of hers in the desktop chat holds pictures she drew, each one
// opens in a widget window of its own (widgets/dahlia-picture), on top until it is closed; "Float on the desktop" in a
// picture's message menu opens one by hand. Settings > Dahlia turns the automatic part off. After the image widgets of
// dasilva333/airi. This file is Dahlia's (AIRI has no such file).

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { dahliaFloatPicturesEnabled, dahliaPictureLinksIn } from '@proj-airi/stage-ui/libs/dahlia-chat-edits'

import { widgetsAdd } from '../shared/eventa'

/** A floating picture's window, in screen pixels. */
export const FLOATING_PICTURE_SIZE = { width: 380, height: 380 }

/** Opens pictures as desktop widgets; `fromReply` opens the ones in her reply when the person wants that. */
export function useDahliaFloatingPictures() {
  const addWidget = useElectronEventaInvoke(widgetsAdd)

  async function float(url: string, caption: string) {
    try {
      await addWidget({
        componentName: 'dahlia-picture',
        componentProps: { src: url, caption },
        windowSize: FLOATING_PICTURE_SIZE,
        alwaysOnTop: true,
        ttlMs: 0,
      })
    }
    catch (error) {
      console.warn('Dahlia: her picture could not float on the desktop:', error)
    }
  }

  async function fromReply(reply: string) {
    if (!dahliaFloatPicturesEnabled())
      return
    for (const picture of dahliaPictureLinksIn(reply))
      await float(picture.url, picture.title)
  }

  return { float, fromReply }
}
