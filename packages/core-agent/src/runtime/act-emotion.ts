import { normalizeActPayload } from '@proj-airi/pipelines-audio'

const ACT_PREFIX = '<|ACT '
const ACT_SUFFIX = '|>'

/**
 * Dahlia: the emotion that an `<|ACT {...}|>` marker sets, or undefined for any other marker,
 * an unreadable one and `neutral`. The first one of a reply tints its chat bubble.
 */
export function readActEmotion(special: string): string | undefined {
  const trimmed = special.trim()
  if (!trimmed.startsWith(ACT_PREFIX) || !trimmed.endsWith(ACT_SUFFIX))
    return undefined

  try {
    const payload: unknown = JSON.parse(trimmed.slice(ACT_PREFIX.length, -ACT_SUFFIX.length))
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
      return undefined

    const name = normalizeActPayload(payload as Record<string, unknown>).emotion?.name
    return name && name !== 'neutral' ? name : undefined
  }
  catch {
    return undefined
  }
}
