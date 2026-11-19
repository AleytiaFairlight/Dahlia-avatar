import { describe, expect, it } from 'vitest'

import { BUBBLE_TAIL_PX, bubbleMood, bubblePartMs, bubbleParts, placeBubble, wrapBubbleText } from './dahlia-speech-bubble'

describe('dahlia speech bubble', () => {
  it('cuts a long piece after a sentence or a comma, and keeps a short one whole', () => {
    expect(bubbleParts('Hello there!')).toEqual(['Hello there!'])
    const long = 'I looked at the build for a while. The error comes from the second project, which still points at the old package, so it fails.'
    const parts = bubbleParts(long, 60)
    expect(parts[0]).toBe('I looked at the build for a while.')
    expect(parts.join(' ')).toBe(long)
    expect(parts.every(part => part.length <= 61)).toBe(true)
    expect(bubblePartMs('x'.repeat(10))).toBe(1200)
    expect(bubblePartMs('x'.repeat(200))).toBe(2800)
  })

  it('wraps to the width and ends a text that is too long with "…"', () => {
    const measure = (line: string) => line.length * 10
    expect(wrapBubbleText('one two three four', measure, 100, 4)).toEqual(['one two', 'three four'])
    const lines = wrapBubbleText('aa bb cc dd ee ff gg hh', measure, 50, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })

  it('goes above her head on the side with room', () => {
    const stage = { width: 800, height: 600 }
    const bubble = { width: 200, height: 60 }
    const right = placeBubble({ x: 300, y: 200, width: 100, height: 100 }, bubble, stage)
    expect(right).toEqual({ x: 375, y: 200 - 60 - BUBBLE_TAIL_PX + 15, tail: 'left' })

    const left = placeBubble({ x: 650, y: 200, width: 100, height: 100 }, bubble, stage)
    expect(left.tail).toBe('right')
    expect(left.x + bubble.width).toBeLessThanOrEqual(800 - 8)

    expect(placeBubble({ x: 300, y: 10, width: 100, height: 100 }, bubble, stage).y, 'kept inside the stage').toBe(8)
  })

  it('knows the feelings of her expressions', () => {
    expect(bubbleMood('happy')).toBe('happy')
    expect(bubbleMood('question')).toBe('curious')
    expect(bubbleMood('smug')).toBeUndefined()
  })
})
