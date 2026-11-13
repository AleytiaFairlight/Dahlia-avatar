// Dahlia: the sentence she is saying is marked in the chat. The stage tells the caption window what it speaks,
// piece by piece; this listens to the same channel, finds that piece in her newest message on the page and marks
// it with the CSS Custom Highlight API, which paints over the text without changing the page (so nothing is
// re-rendered and Vue's rendering isn't disturbed). The idea is the spoken highlight of dasilva333/airi
// (7261d8d1c); the code is Dahlia's and needs no change to the chat's components. The apps' main.ts starts it
// (scripts/apply_avatar_branding.sh adds the call). This file is Dahlia's (AIRI has no such file).

/** "false" when the person turned the highlight off (Settings > Dahlia); on otherwise. */
export const DAHLIA_SPOKEN_HIGHLIGHT_KEY = 'dahlia/spoken-highlight'
const HIGHLIGHT = 'dahlia-speaking'
/** Without a new piece for this long she has stopped speaking. */
const CLEAR_AFTER_MS = 12_000
/** Her newest texts on the page are searched, this many at most (a message can be several bubbles). */
const MESSAGES = 12

export interface SpokenPlace { startNode: number, startOffset: number, endNode: number, endOffset: number }

function letter(char: string) {
  return /[\p{L}\p{N}]/u.test(char)
}

/**
 * Where a spoken piece is in a message's text nodes. Speech and page differ in spaces, punctuation and markup,
 * so only letters and digits are compared. `from` is the letter count already spoken in this message: the search
 * starts there first, so a phrase that occurs twice is found where she is, and from the start when it isn't there.
 */
export function locateSpoken(nodes: string[], spoken: string, from = 0): (SpokenPlace & { next: number }) | undefined {
  const wanted = [...spoken.toLowerCase()].filter(letter).join('')
  if (wanted.length < 2)
    return undefined

  const places: Array<[node: number, offset: number, length: number]> = []
  let skeleton = ''
  nodes.forEach((text, node) => {
    let offset = 0
    for (const char of text) {
      if (letter(char)) {
        // A character can become several when lowered ("İ"); each keeps its place.
        for (const lowered of char.toLowerCase()) {
          skeleton += lowered
          places.push([node, offset, char.length])
        }
      }
      offset += char.length
    }
  })

  let at = skeleton.indexOf(wanted, Math.min(from, skeleton.length))
  if (at < 0)
    at = skeleton.indexOf(wanted)
  if (at < 0)
    return undefined
  const first = places[at]
  const last = places[at + wanted.length - 1]
  return { startNode: first[0], startOffset: first[1], endNode: last[0], endOffset: last[1] + last[2], next: at + wanted.length }
}

export function dahliaSpokenHighlightEnabled() {
  try {
    return localStorage.getItem(DAHLIA_SPOKEN_HIGHLIGHT_KEY) !== 'false'
  }
  catch {
    return true
  }
}

interface HighlightRegistry { set: (name: string, highlight: unknown) => void, delete: (name: string) => void }

/** Starts marking what she says in this window's chat. Does nothing where the browser can't. */
export function startDahliaSpokenHighlight() {
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights
  const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (!registry || !HighlightClass || typeof BroadcastChannel === 'undefined' || typeof document === 'undefined')
    return

  const style = document.createElement('style')
  style.textContent = `::highlight(${HIGHLIGHT}) { background-color: rgb(244 114 182 / 0.3); }`
  document.head.append(style)

  let spokenIn: Element | undefined
  let spokenLetters = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => registry.delete(HIGHLIGHT)

  const channel = new BroadcastChannel('airi-caption-overlay')
  channel.onmessage = (event) => {
    const data = event.data as { type?: string, text?: string } | undefined
    if (data?.type !== 'caption-assistant')
      return
    clearTimeout(timer)
    const text = data.text?.trim() ?? ''
    if (!text || !dahliaSpokenHighlightEnabled()) {
      clear()
      spokenIn = undefined
      spokenLetters = 0
      return
    }

    const messages = [...document.querySelectorAll('.markdown-content')].slice(-MESSAGES).reverse()
    for (const message of messages) {
      const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      while (walker.nextNode())
        nodes.push(walker.currentNode as Text)
      const place = locateSpoken(nodes.map(node => node.data), text, message === spokenIn ? spokenLetters : 0)
      if (!place)
        continue
      const range = document.createRange()
      range.setStart(nodes[place.startNode], place.startOffset)
      range.setEnd(nodes[place.endNode], place.endOffset)
      registry.set(HIGHLIGHT, new HighlightClass(range))
      spokenIn = message
      spokenLetters = place.next
      timer = setTimeout(clear, CLEAR_AFTER_MS)
      return
    }
    clear()
  }
}
