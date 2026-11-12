import { describe, expect, it } from 'vitest'

import { dahliaAssistantReaction } from './dahlia-assistant-reactions'

describe('dahlia assistant reactions', () => {
  it('shows each state of a coding agent', () => {
    expect(dahliaAssistantReaction({ state: 'work', assistant: 'Claude Code', headline: 'Editing  Program.cs' })).toEqual({ emotion: 'think', caption: 'Claude Code is working: Editing Program.cs' })
    expect(dahliaAssistantReaction({ state: 'wait', assistant: 'Claude Code', note: 'Allow Bash?', headline: 'ignored' })).toEqual({ emotion: 'question', caption: 'Claude Code is waiting for you: Allow Bash?' })
    expect(dahliaAssistantReaction({ state: 'done' })).toEqual({ emotion: 'happy', animation: 'peace_sign', caption: 'The assistant is done.' })
    expect(dahliaAssistantReaction({ state: 'error', note: 'Tests failed' })?.caption).toBe('The assistant ran into a problem: Tests failed')
    expect(dahliaAssistantReaction({ state: 'idle' })).toEqual({ emotion: 'neutral' })
    expect(dahliaAssistantReaction({ state: 'dance' })).toBeUndefined()
    expect(dahliaAssistantReaction({ state: 'work', headline: 'x'.repeat(300) })!.caption!.length).toBeLessThan(150)
  })
})
