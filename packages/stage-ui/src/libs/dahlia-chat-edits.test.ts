import type { ChatAssistantMessage, ChatHistoryItem } from '../types/chat'

import { describe, expect, it } from 'vitest'

import { dahliaPictureLinksIn, dahliaPicturesIn, editableTextOf, withEditedAssistantText, withEditedUserText } from './dahlia-chat-edits'

type UserMessage = Extract<ChatHistoryItem, { role: 'user' }>

function reply(fields: Partial<ChatAssistantMessage>): ChatAssistantMessage {
  return { role: 'assistant', content: '', slices: [], tool_results: [], ...fields }
}

describe('editableTextOf', () => {
  it('reads the text parts of a message with an image', () => {
    const message: UserMessage = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }, { type: 'text', text: 'look' }] }

    expect(editableTextOf(message)).toBe('look')
  })

  it('reads her text slices and skips her tool calls', () => {
    const message = reply({
      content: 'raw',
      slices: [
        { type: 'text', text: 'One.' },
        { type: 'tool-call', toolCall: { toolCallId: 'a', toolName: 'search', args: '{}', toolCallType: 'function' } },
        { type: 'text', text: 'Two.' },
      ],
    })

    expect(editableTextOf(message)).toBe('One.\n\nTwo.')
  })
})

describe('withEditedUserText', () => {
  it('replaces the text and keeps the image in its place', () => {
    const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AA' } }
    const message: UserMessage = { role: 'user', id: 'm1', content: [image, { type: 'text', text: 'old' }] }

    expect(withEditedUserText(message, ' new ')?.content).toEqual([image, { type: 'text', text: 'new' }])
  })

  it('refuses a message that the edit would empty', () => {
    expect(withEditedUserText({ role: 'user', content: 'hi' }, '  ')).toBeUndefined()
  })
})

describe('withEditedAssistantText', () => {
  it('replaces the text, keeps the tool call and rewrites the transcript the next request reads', () => {
    const toolCall = { type: 'tool-call' as const, toolCall: { toolCallId: 'a', toolName: 'search', args: '{}', toolCallType: 'function' as const } }
    const message = reply({
      content: 'Old answer.',
      slices: [{ type: 'text', text: 'Looking.' }, toolCall, { type: 'text', text: 'Old answer.' }],
      categorization: { speech: 'Old answer.', reasoning: 'thought' },
      providerTranscript: [{ role: 'assistant', content: 'Old answer.' }],
      generationTranscript: {
        type: 'assistant',
        id: 't1',
        status: 'completed',
        rounds: [
          { id: 'r1', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool', invocationId: 'i1' }], toolInvocations: [], projectionIssues: [] },
          { id: 'r2', content: [{ type: 'text', text: 'Old answer.' }], toolInvocations: [], projectionIssues: [], continuation: { scope: 's', protocol: 'chat-completions', data: [] } },
        ],
      },
    })

    const edited = withEditedAssistantText(message, 'New answer.')

    expect(edited.slices).toEqual([{ type: 'text', text: 'New answer.' }, toolCall])
    expect(edited.content).toBe('New answer.')
    expect(edited.categorization).toEqual({ speech: 'New answer.', reasoning: 'thought' })
    expect(edited.providerTranscript).toBeUndefined()
    expect(edited.generationTranscript?.rounds.map(round => round.content)).toEqual([
      [{ type: 'tool', invocationId: 'i1' }],
      [{ type: 'text', text: 'New answer.' }],
    ])
    expect(edited.generationTranscript?.rounds[1]).not.toHaveProperty('continuation')
  })
})

describe('dahliaPicturesIn', () => {
  it('finds the pictures she drew and nothing else', () => {
    const message = reply({
      slices: [{ type: 'text', text: 'Here!\n\n![a red fox](https://hub.local:8091/api/v1/dahlia/images/abc-123.png)\n\n![other](https://example.com/cat.png)' }],
    })

    expect(dahliaPicturesIn(message)).toEqual([{ url: 'https://hub.local:8091/api/v1/dahlia/images/abc-123.png', title: 'a red fox' }])
    expect(dahliaPicturesIn({ role: 'user', content: '![x](https://hub.local/api/v1/dahlia/images/abc.png)' })).toEqual([])
    expect(dahliaPictureLinksIn('Done!\n\n![a cat](https://hub.local/api/v1/dahlia/images/c-1.png) and ![a dog](https://hub.local/api/v1/dahlia/images/d-2.png)').map(picture => picture.title)).toEqual(['a cat', 'a dog'])
  })
})
