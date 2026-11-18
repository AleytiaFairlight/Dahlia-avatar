import type { PortableProviderId } from '../index'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { createProviderRegistry, getDefinedProvider, listProviders, portableProviderDefinitions } from '../index'

describe('portable provider registry', () => {
  it('exports the portable provider id union', () => {
    expectTypeOf<'speech-noop'>().toExtend<PortableProviderId>()
    expectTypeOf<string>().not.toExtend<PortableProviderId>()

    expect(getDefinedProvider('speech-noop')).toBeDefined()
  })

  it('registers each portable definition by id', () => {
    for (const definition of portableProviderDefinitions)
      expect(getDefinedProvider(definition.id)).toBe(definition)
  })

  it('lists definitions in deterministic display order', () => {
    expect(listProviders()).toEqual(listProviders())
  })

  it('places definitions without an order after all ordered definitions', () => {
    const [template] = portableProviderDefinitions
    const registry = createProviderRegistry([
      { ...template, id: 'unordered-z', name: 'Zeta', order: undefined },
      { ...template, id: 'high-order', name: 'High order', order: 100_000 },
      { ...template, id: 'unordered-a', name: 'Alpha', order: undefined },
    ])

    expect(registry.list().map(provider => provider.id)).toEqual([
      'high-order',
      'unordered-a',
      'unordered-z',
    ])
  })

  // Dahlia: AIRI's catalog of third-party providers is deleted. "No speech" is the only portable definition.
  it('lists only the no-speech definition', () => {
    expect(listProviders().map(provider => provider.id)).toEqual(['speech-noop'])
  })
})
