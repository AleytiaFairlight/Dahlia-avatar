import { describe, expect, it } from 'vitest'

import { locateSpoken } from './dahlia-spoken-highlight'

/** The text between the places found. */
function marked(nodes: string[], spoken: string, from = 0) {
  const place = locateSpoken(nodes, spoken, from)
  if (!place)
    return undefined
  if (place.startNode === place.endNode)
    return nodes[place.startNode].slice(place.startOffset, place.endOffset)
  return [nodes[place.startNode].slice(place.startOffset), ...nodes.slice(place.startNode + 1, place.endNode), nodes[place.endNode].slice(0, place.endOffset)].join('')
}

describe('dahlia spoken highlight', () => {
  it('finds a spoken piece in the page\'s text, across markup, spaces and punctuation', () => {
    const nodes = ['Sure! The ', 'quick', ' brown fox — jumps.\n', 'Then it sleeps.']
    expect(marked(nodes, 'The quick brown fox jumps.')).toBe('The quick brown fox — jumps')
    expect(marked(nodes, ' then it SLEEPS ')).toBe('Then it sleeps')
    expect(marked(nodes, 'A purple cat')).toBeUndefined()
    expect(marked(nodes, '!')).toBeUndefined()
  })

  it('goes on from where she is when a phrase occurs twice, and starts over when it isn\'t ahead', () => {
    const nodes = ['Yes, I know. ', 'I know it well. ', 'Yes.']
    const first = locateSpoken(nodes, 'I know')!
    expect(first.startNode).toBe(0)
    const second = locateSpoken(nodes, 'I know', first.next)!
    expect(second.startNode).toBe(1)
    expect(locateSpoken(nodes, 'Yes, I know', second.next)!.startNode, 'not ahead: from the start').toBe(0)
    expect(marked(['ピース、ですね。'], 'ピースですね')).toBe('ピース、ですね')
  })
})
