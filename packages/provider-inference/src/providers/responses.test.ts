import type { ChatRequestOptions, GenerationProvider } from '../types'

import { createOpenAI } from '@xsai-ext/providers/create'
import { describe, expect, it } from 'vitest'

import { compatibleProtocols, generationProtocolOptions, openAIProtocols } from '../generation'
import { getGenerationProvider, withReasoning } from '../types'

describe('generation selection', () => {
  it('builds protocol options from the shared protocol registry in provider order', () => {
    expect(generationProtocolOptions(openAIProtocols)).toEqual([
      { label: 'Responses API', value: 'responses' },
      { label: 'Chat Completions', value: 'chat-completions' },
    ])
    expect(generationProtocolOptions(compatibleProtocols)).toEqual([
      { label: 'Chat Completions', value: 'chat-completions' },
      { label: 'Responses API', value: 'responses' },
    ])
  })
})

it('adapts existing SDK instances once', () => {
  const inference = getGenerationProvider(createOpenAI('test', 'https://example.test/v1/'))
  expect(inference?.generation('model')).toMatchObject({ protocol: 'chat-completions', config: { model: 'model' } })
  if (!inference)
    throw new Error('Expected a chat inference provider')
  expect(getGenerationProvider(inference)).toBe(inference)
})

it('applies one reasoning choice to every request', () => {
  const sdk = getGenerationProvider(createOpenAI('test', 'https://example.test/v1/'))
  if (!sdk)
    throw new Error('Expected a chat inference provider')
  const received: Array<ChatRequestOptions | undefined> = []
  const inference: GenerationProvider = {
    generation: (model, options) => {
      received.push(options)
      return sdk.generation(model)
    },
  }

  withReasoning(inference, { reasoning: 'disabled' }).generation('model', { reasoning: 'enabled' })
  withReasoning(inference, undefined).generation('model')
  expect(received).toEqual([{ reasoning: 'disabled' }, undefined])
})
