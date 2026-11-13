// Dahlia: several chat bubbles for one answer. People send a thought, then the next, not one block; an answer of
// hers with several paragraphs is now shown as several bubbles, one a thought, in the order she wrote them. The
// text of the message is untouched (copying, memory and speech see one message); only its display is split, at
// blank lines, never inside a code block, a list or a table. While she is still writing, the bubbles that are
// finished stand and the last one grows. The idea is the multi-bubble delivery of dasilva333/airi
// (docs/design-conversational-cadence-multi-bubble.md), which decides the split with its classifier and holds
// the text back until it can; hers splits where she herself left a blank line and shows text as it comes.
// components/scenarios/chat/components/dahlia-chat-bubbles.vue shows them. This file is Dahlia's.

/** "false" when the person turned the bubbles off (Settings > Dahlia); on otherwise. */
export const DAHLIA_CHAT_BUBBLES_KEY = 'dahlia/chat-bubbles'
/** More paragraphs than this are gathered into this many bubbles. */
export const CHAT_BUBBLES_MAX = 5
/** A message shorter than this stays one bubble. */
export const CHAT_BUBBLES_MIN_CHARS = 80

function isListOrTable(block: string) {
  return /^\s*(?:[-*+]\s|\d+[.)]\s|\||>)/.test(block)
}

/**
 * The bubbles of a message. Blank lines separate them; a code block stays whole; a list, a table or a quote stays
 * with the line that introduces it; a heading stays with what follows it.
 */
export function splitDahliaBubbles(text: string): string[] {
  if (text.trim().length < CHAT_BUBBLES_MIN_CHARS)
    return [text]

  // Blocks between blank lines, with code fences kept whole.
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | undefined
  for (const line of text.split('\n')) {
    const mark = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
    if (mark && !fence)
      fence = mark[0]
    else if (mark && fence && mark[0] === fence)
      fence = undefined
    if (!fence && !mark && line.trim() === '') {
      if (current.length > 0)
        blocks.push(current.join('\n'))
      current = []
    }
    else {
      current.push(line)
    }
  }
  if (current.length > 0)
    blocks.push(current.join('\n'))
  if (blocks.length < 2)
    return [text]

  const bubbles: string[] = []
  for (const block of blocks) {
    const before = bubbles.at(-1)
    const joins = before !== undefined && (
      isListOrTable(block) // the list belongs to the line that introduces it
      || /^\s*#{1,6}\s[^\n]*$/.test(before) // a heading alone belongs to what follows
      || /[:：]\s*$/.test(before) // "Here is what I found:" and then the thing
      || before.trim().length < 25 // a very short opener doesn't stand alone
    )
    if (joins)
      bubbles[bubbles.length - 1] = `${before}\n\n${block}`
    else
      bubbles.push(block)
  }

  // Too many: the last ones are gathered, so the first thoughts keep their own bubbles.
  while (bubbles.length > CHAT_BUBBLES_MAX) {
    const last = bubbles.pop()!
    bubbles[bubbles.length - 1] = `${bubbles.at(-1)}\n\n${last}`
  }
  return bubbles
}

export function dahliaChatBubblesEnabled() {
  try {
    return localStorage.getItem(DAHLIA_CHAT_BUBBLES_KEY) !== 'false'
  }
  catch {
    return true
  }
}
