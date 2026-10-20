// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { withDahliaChat } from './dahlia-chat'

const state = vi.hoisted(() => ({ apiKey: undefined as string | undefined }))

vi.mock('./providers/config', () => ({
  useProviderConfigStore: () => ({
    getProviderConfig: (providerId: string) => providerId === 'dahlia' && state.apiKey ? { apiKey: state.apiKey } : undefined,
  }),
}))

describe('dahlia chat', () => {
  beforeEach(() => {
    state.apiKey = 'dahlia-key'
  })

  // ROOT CAUSE:
  //
  // The desktop app's onboarding window set the chat choice, and the main window applied the card
  // before that choice arrived, so it saved empty character defaults. Chat then failed with
  // "No chat provider or model configured for this character".
  it('chats through Dahlia\'s server when the character has no chat choice', () => {
    expect(withDahliaChat({ provider: '', model: '' })).toEqual({ provider: 'dahlia', model: 'auto' })
  })

  it('replaces a chat provider that Dahlia\'s build does not have', () => {
    expect(withDahliaChat({ provider: 'openrouter-ai', model: 'openai/gpt-4o' })).toEqual({ provider: 'dahlia', model: 'auto' })
    expect(withDahliaChat({ provider: 'dahlia', model: '' })).toEqual({ provider: 'dahlia', model: 'auto' })
  })

  it('keeps Dahlia\'s provider with its model', () => {
    const selection = { provider: 'dahlia', model: 'auto' }

    expect(withDahliaChat(selection)).toBe(selection)
  })

  it('leaves the choice alone before the Dahlia key is set', () => {
    state.apiKey = undefined

    expect(withDahliaChat({ provider: '', model: '' })).toEqual({ provider: '', model: '' })
  })
})
