import type { AvatarModelReference } from '@proj-airi/core-character'

/** Configuration placeholder for Avatar Model types without an editor contract. */
export type UnconfiguredAvatarModelReference<
  TType extends 'vrm' | 'mmd' | 'spine' | 'tachie',
> = AvatarModelReference<TType, Record<string, never>>

/** Avatar Model references that the current Character format can store. */
export type CharacterAvatarModelReference
  = | UnconfiguredAvatarModelReference<'vrm'>
    | UnconfiguredAvatarModelReference<'mmd'>
    | UnconfiguredAvatarModelReference<'spine'>
    | UnconfiguredAvatarModelReference<'tachie'>
