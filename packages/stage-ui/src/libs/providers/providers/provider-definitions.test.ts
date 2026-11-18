import type { StageProviderId } from './registry'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { getDefinedProvider, listProviders } from './registry'

import './index'

function getRequiredProvider(id: string) {
  const provider = getDefinedProvider(id)
  if (!provider)
    throw new Error(`Provider definition "${id}" is not registered.`)

  return provider
}

// Dahlia: the apps register only Dahlia's chat, Sherpaw's on-device transcription and "no speech".
// AIRI's catalog of third-party providers is deleted.
describe('registered provider definitions', () => {
  it('exposes a closed provider id union to stage-ui consumers', () => {
    expectTypeOf<'dahlia'>().toExtend<StageProviderId>()
    expectTypeOf<'sherpaw-transcription'>().toExtend<StageProviderId>()
    expectTypeOf<'speech-noop'>().toExtend<StageProviderId>()
    expectTypeOf<'openai'>().not.toExtend<StageProviderId>()
    expectTypeOf<string>().not.toExtend<StageProviderId>()
  })

  it('registers only Dahlia, Sherpaw and no speech', () => {
    expect(listProviders().map(provider => provider.id).sort()).toEqual(['dahlia', 'sherpaw-transcription', 'speech-noop'])
  })

  it('returns no definition for an unknown or deleted provider id', () => {
    expect(getDefinedProvider('unknown-provider')).toBeUndefined()
    expect(getDefinedProvider('openai')).toBeUndefined()
    expect(getDefinedProvider('kokoro-local')).toBeUndefined()
  })

  it('creates the no-op speech provider through ProviderDefinition', async () => {
    const definition = getRequiredProvider('speech-noop')
    const provider = await definition.createProvider({})

    expect(provider).toHaveProperty('speech')
    expect('speech' in provider && provider.speech('unused')).toMatchObject({
      baseURL: 'http://speech-noop.invalid/v1/',
      model: 'noop',
    })
  })
})
