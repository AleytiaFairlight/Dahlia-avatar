import type { CharacterAvatarModelReference } from '../types/avatar-model'

import { nanoid } from 'nanoid'

import { DisplayModelFormat } from '../stores/display-models'

/** Creates a Character reference for a stored Display Model. */
export function createAvatarModelReference(displayModelId: string, format: DisplayModelFormat): CharacterAvatarModelReference {
  let type: CharacterAvatarModelReference['type']
  switch (format) {
    case DisplayModelFormat.VRM:
      type = 'vrm'
      break
    case DisplayModelFormat.SpineZip:
      type = 'spine'
      break
    case DisplayModelFormat.TachieZip:
      type = 'tachie'
      break
    case DisplayModelFormat.PMXDirectory:
    case DisplayModelFormat.PMXZip:
    case DisplayModelFormat.PMD:
      type = 'mmd'
      break
  }

  return { id: nanoid(), displayModelId, type, config: {} }
}
