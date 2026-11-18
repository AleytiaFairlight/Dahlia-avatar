import type { ProviderTranslator } from '../types'

import { describe, expect, it } from 'vitest'

import { portableProviderDefinitions } from '.'

const translate: ProviderTranslator = key => key
// Dahlia: "no speech" is the only portable definition since AIRI's catalog was deleted.
const browserOnlyProviderIds = new Set<string>()
const localApiProviderIds = new Set<string>()
const localRunProviderIds = new Set(['speech-noop'])

function testCategory(providerId: string): 'cloud-api' | 'local-api' | 'local-run' {
  if (localApiProviderIds.has(providerId))
    return 'local-api'
  if (localRunProviderIds.has(providerId))
    return 'local-run'
  return 'cloud-api'
}

function testRuntimeResult(providerId: string): 'browser-only' | 'node-and-browser' {
  return browserOnlyProviderIds.has(providerId) ? 'browser-only' : 'node-and-browser'
}

describe('portable provider runtime matrix in Browser', () => {
  for (const definition of portableProviderDefinitions) {
    const category = testCategory(definition.id)
    const result = testRuntimeResult(definition.id)

    it(`[${category}/${result}] loads ${definition.id}`, async () => {
      const schema = await definition.createProviderConfig({ t: translate })

      expect(schema).toBeDefined()
    })
  }
})
