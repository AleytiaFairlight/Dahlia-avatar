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
  }

  return { id: nanoid(), displayModelId, type, config: {} }
}
