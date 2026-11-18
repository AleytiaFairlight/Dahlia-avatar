import type { ChatHistoryReplyPayload } from '../reply'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useChatComposer } from './use-chat-composer'

describe('useChatComposer', () => {
  it('sends a native reply without changing the draft text', async () => {
    const activeSessionId = shallowRef('session-1')
    const send = vi.fn().mockResolvedValue(undefined)
    const composer = useChatComposer({ activeSessionId, send })
    const target: ChatHistoryReplyPayload = {
      label: 'Dahlia',
      message: { id: 'assistant-1', role: 'assistant', content: 'Reply target', slices: [], tool_results: [] },
    }
    composer.draft.value = 'My answer'
    composer.selectReply(target)

    await expect(composer.submit()).resolves.toBe('sent')

    expect(send).toHaveBeenCalledWith({
      attachments: [],
      sessionId: 'session-1',
      replyToMessageId: 'assistant-1',
      text: 'My answer',
    })
    expect(composer.draft.value).toBe('')
    expect(composer.replyTarget.value).toBeUndefined()
  })

  it('captures the submission before awaiting pre-send work', async () => {
    const activeSessionId = shallowRef('session-1')
    const send = vi.fn().mockResolvedValue(undefined)
    const composer = useChatComposer({ activeSessionId, send })
    composer.draft.value = 'Interrupt here'

    await composer.submit({
      beforeSend: async (submission) => {
        activeSessionId.value = 'session-2'
        expect(submission.sessionId).toBe('session-1')
        expect(submission.text).toBe('Interrupt here')
      },
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      text: 'Interrupt here',
    }))
  })

  it('announces that sending started after invoking the send boundary', async () => {
    const events: string[] = []
    const activeSessionId = shallowRef('session-1')
    const send = vi.fn(async () => {
      events.push('send-started')
    })
    const composer = useChatComposer({ activeSessionId, send })
    composer.draft.value = 'Interrupt here'

    await composer.submit({
      afterSendStarted: () => events.push('announced'),
    })

    expect(events).toEqual(['send-started', 'announced'])
  })

  it('restores a failed send without replacing newer input state', async () => {
    const activeSessionId = shallowRef('session-1')
    const firstTarget: ChatHistoryReplyPayload = {
      label: 'Dahlia',
      message: { id: 'assistant-1', role: 'assistant', content: 'First', slices: [], tool_results: [] },
    }
    const secondTarget: ChatHistoryReplyPayload = {
      label: 'You',
      message: { id: 'user-2', role: 'user', content: 'Second' },
    }
    let composer: ReturnType<typeof useChatComposer>
    const send = vi.fn(async () => {
      composer.draft.value = 'New draft'
      composer.selectReply(secondTarget)
      throw new Error('Provider failed')
    })
    composer = useChatComposer({ activeSessionId, send })
    composer.draft.value = 'My answer'
    composer.selectReply(firstTarget)

    await expect(composer.submit()).resolves.toBe('restored')

    expect(composer.draft.value).toBe('My answer\nNew draft')
    expect(composer.replyTarget.value).toStrictEqual(secondTarget)
  })

  it('discards a failed snapshot after the active session changes', async () => {
    const activeSessionId = shallowRef('session-1')
    const send = vi.fn(async () => {
      activeSessionId.value = 'session-2'
      throw new Error('Provider failed')
    })
    const composer = useChatComposer<string>({ activeSessionId, send })
    composer.draft.value = 'Old draft'
    composer.addAttachments('blob:old')

    await expect(composer.submit()).resolves.toBe('discarded')

    expect(composer.draft.value).toBe('')
    expect(composer.attachments.value).toEqual([])
  })

  it('clears only the reply target that matches the deleted message', () => {
    const target: ChatHistoryReplyPayload = {
      label: 'Dahlia',
      message: { id: 'assistant-2', role: 'assistant', content: 'Target', slices: [], tool_results: [] },
    }
    const composer = useChatComposer({ activeSessionId: shallowRef('session-1'), send: vi.fn() })
    composer.selectReply(target)

    composer.clearReplyForMessage({ id: 'user-1', role: 'user', content: 'Earlier message' })
    expect(composer.replyTarget.value).toStrictEqual(target)

    composer.clearReplyForMessage({ id: 'assistant-2', role: 'assistant', content: 'Updated target', slices: [], tool_results: [] })
    expect(composer.replyTarget.value).toBeUndefined()
  })
})

// Dahlia: a chat surface keeps its unsent text across a restart.
describe('useChatComposer saved drafts', () => {
  function fakeStorage() {
    const items = new Map<string, string>()
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    }
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('saves the text a moment after typing and restores it in the next composer', async () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const scope = effectScope()
    const composer = scope.run(() => useChatComposer({ activeSessionId: shallowRef('session-1'), send: vi.fn(), draftStorageKey: 'dahlia/chat-draft/test' }))!

    composer.draft.value = 'Half a thought'
    await nextTick()
    expect(storage.items.has('dahlia/chat-draft/test')).toBe(false)
    vi.advanceTimersByTime(500)
    expect(storage.items.get('dahlia/chat-draft/test')).toBe('Half a thought')
    scope.stop()

    const next = useChatComposer({ activeSessionId: shallowRef('session-1'), send: vi.fn(), draftStorageKey: 'dahlia/chat-draft/test' })
    expect(next.draft.value).toBe('Half a thought')
  })

  it('forgets the draft once it is sent, and saves a pending edit when the composer closes', async () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const scope = effectScope()
    const composer = scope.run(() => useChatComposer({ activeSessionId: shallowRef('session-1'), send: vi.fn().mockResolvedValue(undefined), draftStorageKey: 'k' }))!

    composer.draft.value = 'Send me'
    await nextTick()
    vi.advanceTimersByTime(500)
    await expect(composer.submit()).resolves.toBe('sent')
    vi.advanceTimersByTime(500)
    expect(storage.items.has('k')).toBe(false)

    composer.draft.value = 'Typed just before closing'
    await nextTick()
    scope.stop()
    expect(storage.items.get('k')).toBe('Typed just before closing')
  })

  it('keeps the draft in memory only without a key', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const composer = useChatComposer({ activeSessionId: shallowRef('session-1'), send: vi.fn() })
    composer.draft.value = 'Not saved'
    await nextTick()
    expect(storage.items.size).toBe(0)
  })
})
