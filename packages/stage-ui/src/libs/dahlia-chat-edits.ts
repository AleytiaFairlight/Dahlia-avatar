// Dahlia: the owner edits a message of the chat in place, theirs or hers, and turns one of her pictures into the
// stage background. These helpers work on a stored message; the session store saves the result.

import type { ChatAssistantMessage, ChatHistoryItem, ChatSlices } from '../types/chat'

type UserMessage = Extract<ChatHistoryItem, { role: 'user' }>

/** A picture she drew with her Image Generation module: its address on the hub ends in /api/v1/dahlia/images/<id>.png. */
const PICTURE_PATTERN = /!\[([^\]]*)\]\((\S+?\/api\/v1\/dahlia\/images\/[\w-]+\.png)\)/g

function assistantTextOf(message: ChatAssistantMessage): string {
  const texts = message.slices?.filter(slice => slice.type === 'text').map(slice => slice.text) ?? []
  if (texts.length)
    return texts.join('\n\n')
  if (typeof message.content === 'string')
    return message.content
  if (Array.isArray(message.content))
    return message.content.flatMap(part => 'type' in part && part.type === 'text' ? [part.text] : []).join('\n\n')
  return ''
}

/** The text that the owner edits: the text of their message, or the text of her reply without its tool calls. */
export function editableTextOf(message: ChatHistoryItem): string {
  if (message.role === 'assistant')
    return assistantTextOf(message)
  if (message.role !== 'user')
    return ''
  if (typeof message.content === 'string')
    return message.content
  return message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
}

/**
 * The owner's message with its text replaced. Its images and recordings stay. Returns undefined when the message would
 * be empty, because an empty message cannot be sent again.
 */
export function withEditedUserText(message: UserMessage, text: string): UserMessage | undefined {
  const value = text.trim()
  if (typeof message.content === 'string')
    return value ? { ...message, content: value } : undefined

  const first = message.content.findIndex(part => part.type === 'text')
  const others = message.content.filter(part => part.type !== 'text')
  if (!value)
    return others.length ? { ...message, content: others } : undefined
  // The text keeps the place of the old text, so the attachments stay where they were.
  const at = first < 0 ? others.length : message.content.slice(0, first).filter(part => part.type !== 'text').length
  return { ...message, content: [...others.slice(0, at), { type: 'text', text: value }, ...others.slice(at)] }
}

/**
 * Her reply with its text replaced. Tool calls, stickers and cards stay. The next request reads the new text, because
 * the stored transcript gets the same text and loses the provider's own copy of the turn.
 */
export function withEditedAssistantText(message: ChatAssistantMessage, text: string): ChatAssistantMessage {
  const value = text.trim()
  const slices: ChatSlices[] = message.slices?.filter(slice => slice.type !== 'text') ?? []
  if (value) {
    const first = message.slices?.findIndex(slice => slice.type === 'text') ?? -1
    const at = first < 0 ? slices.length : message.slices.slice(0, first).filter(slice => slice.type !== 'text').length
    slices.splice(at, 0, { type: 'text', text: value })
  }

  const transcript = message.generationTranscript
  const last = (transcript?.rounds.length ?? 0) - 1
  const generationTranscript = transcript && {
    ...transcript,
    rounds: transcript.rounds.map((round, index) => {
      // Provider continuation data replays the old reply, so the edited turn goes without it.
      const { continuation: _continuation, ...rest } = round
      const content: typeof round.content = round.content.filter(part => part.type !== 'text')
      if (index === last && value)
        content.push({ type: 'text', text: value })
      return { ...rest, content }
    }),
  }

  return {
    ...message,
    content: value,
    slices,
    categorization: message.categorization && { ...message.categorization, speech: value },
    providerTranscript: undefined,
    generationTranscript,
  }
}

/** The pictures she drew in a reply, in order, each with the words she gave it. */
export function dahliaPicturesIn(message: ChatHistoryItem): { url: string, title: string }[] {
  if (message.role !== 'assistant')
    return []
  return [...assistantTextOf(message).matchAll(PICTURE_PATTERN)].map(match => ({ url: match[2]!, title: match[1]!.trim() }))
}
