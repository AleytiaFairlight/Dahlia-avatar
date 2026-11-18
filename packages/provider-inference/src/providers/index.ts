import type { ProviderDefinition } from '../types'

import { providerSpeechNoop } from './local/speech-noop'

/**
 * Erases configuration types at the registry boundary.
 *
 * A registry selects definitions by a runtime id. It cannot know the selected
 * configuration type. Individual provider exports preserve their exact type.
 */
type ProviderDefinitionRegistration<TId extends string = string> = Pick<ProviderDefinition, 'name' | 'order'> & { id: TId }

type ErasedProviderDefinitions<TDefinitions extends readonly ProviderDefinitionRegistration[]> = {
  [K in keyof TDefinitions]: TDefinitions[K] extends ProviderDefinitionRegistration<infer TId>
    ? ProviderDefinition<Record<string, unknown>, TId>
    : never
}

function eraseProviderDefinitions<const TDefinitions extends readonly ProviderDefinitionRegistration[]>(
  ...definitions: TDefinitions
): ErasedProviderDefinitions<TDefinitions> {
  return definitions as unknown as ErasedProviderDefinitions<TDefinitions>
}

/**
 * Definitions that can load without Vue, Pinia, persistence, or Electron.
 *
 * Dahlia keeps only "no speech" here. AIRI's catalog of third-party providers is deleted; Sherpaw has its own
 * factory, `createSherpawTranscriptionDefinition`, because its host supplies the models and the Worker.
 */
export const portableProviderDefinitions = eraseProviderDefinitions(
  providerSpeechNoop,
)

export { createProviderRegistry, defineProvider } from './registry'
