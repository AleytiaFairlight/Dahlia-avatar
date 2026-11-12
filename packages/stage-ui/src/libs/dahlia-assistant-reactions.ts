// Dahlia: her avatar reacts to a coding agent. When a coding agent such as Claude Code starts working, waits for
// the person's OK, finishes or fails, her server tells the desktop app (its hidden assistant_state tool), and
// her avatar shows it: an expression, a caption, and a little animation when the work is done. She says
// nothing aloud and no model turn is spent. The idea is the code assistant notifications of dasilva333/airi
// (docs/design-code-assistant-notifications.md); the code is Dahlia's. This file is Dahlia's.

export type DahliaAssistantState = 'work' | 'wait' | 'done' | 'error' | 'idle'

export interface DahliaAssistantReaction {
  /** What the caption says; undefined for none. */
  caption?: string
  /** The emotion of an ACT token: happy, sad, think, question, neutral. */
  emotion: string
  /** An animation of her library to play, when she has it. */
  animation?: string
}

/** "false" when the person turned the reactions off (Settings > Dahlia); on otherwise. */
export const DAHLIA_ASSISTANT_REACTIONS_KEY = 'dahlia/assistant-reactions'

function clean(text: unknown, max = 120) {
  const line = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** How her avatar shows a coding agent's state. */
export function dahliaAssistantReaction(args: { state?: unknown, assistant?: unknown, headline?: unknown, note?: unknown }): DahliaAssistantReaction | undefined {
  const who = clean(args.assistant, 40) || 'The assistant'
  const headline = clean(args.headline)
  const note = clean(args.note)
  switch (args.state) {
    case 'work':
      return { emotion: 'think', caption: headline ? `${who} is working: ${headline}` : `${who} is working.` }
    case 'wait':
      return { emotion: 'question', caption: `${who} is waiting for you${note || headline ? `: ${note || headline}` : '.'}` }
    case 'done':
      return { emotion: 'happy', animation: 'peace_sign', caption: headline ? `${who} is done: ${headline}` : `${who} is done.` }
    case 'error':
      return { emotion: 'sad', caption: `${who} ran into a problem${note || headline ? `: ${note || headline}` : '.'}` }
    case 'idle':
      return { emotion: 'neutral' }
    default:
      return undefined
  }
}

export function dahliaAssistantReactionsEnabled() {
  try {
    return localStorage.getItem(DAHLIA_ASSISTANT_REACTIONS_KEY) !== 'false'
  }
  catch {
    return true
  }
}
