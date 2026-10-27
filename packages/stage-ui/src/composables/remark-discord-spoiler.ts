import type { Root, Text } from 'mdast'
import type { Plugin } from 'unified'

import { visit } from 'unist-util-visit'

// Dahlia: Discord-style spoilers, `||hidden||`, which AIRI's markdown pipeline does not have. Each `||...||` in a text
// node becomes a <span class="spoiler">; the markdown renderer (markdown-renderer.vue) reveals it on click or Enter.
// Inline only (no newline inside), matching Discord. This is a Dahlia file; AIRI has no such plugin.

const SPOILER = /\|\|(.+?)\|\|/g

/** A span the renderer shows as a hidden box. Not a standard mdast node, so it carries its own hast mapping. */
interface SpoilerNode {
  type: 'spoiler'
  children: Text[]
  data: { hName: string, hProperties: Record<string, unknown> }
}

function spoilerNode(text: string): SpoilerNode {
  return {
    type: 'spoiler',
    children: [{ type: 'text', value: text }],
    data: {
      hName: 'span',
      hProperties: { className: ['spoiler'], role: 'button', tabIndex: 0, ariaLabel: 'Spoiler, click to reveal' },
    },
  }
}

export const remarkDiscordSpoiler: Plugin<[], Root> = () => (tree) => {
  visit(tree, 'text', (node: Text, index, parent) => {
    if (!parent || index == null || !node.value.includes('||'))
      return

    const pieces: Array<Text | SpoilerNode> = []
    let last = 0
    SPOILER.lastIndex = 0
    for (let match = SPOILER.exec(node.value); match; match = SPOILER.exec(node.value)) {
      if (match.index > last)
        pieces.push({ type: 'text', value: node.value.slice(last, match.index) })
      pieces.push(spoilerNode(match[1]))
      last = match.index + match[0].length
    }
    if (pieces.length === 0)
      return

    if (last < node.value.length)
      pieces.push({ type: 'text', value: node.value.slice(last) })
    parent.children.splice(index, 1, ...(pieces as Text[]))
    // Carry on after the nodes that replaced this one, so their text is not scanned again.
    return index + pieces.length
  })
}
