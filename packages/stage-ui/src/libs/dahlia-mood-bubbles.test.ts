import { describe, expect, it } from 'vitest'

import { dahliaMoodBubbleStyle } from './dahlia-mood-bubbles'

describe('dahliaMoodBubbleStyle', () => {
  it('tints a bubble for each of her emotions', () => {
    for (const emotion of ['happy', 'sad', 'angry', 'surprised', 'think', 'curious', 'question', 'awkward'])
      expect(dahliaMoodBubbleStyle(emotion)?.boxShadow).toMatch(/^inset 3px 0 0 #/)
  })

  it('leaves a bubble without an emotion, or with an unknown one, as it is', () => {
    expect(dahliaMoodBubbleStyle(undefined)).toBeUndefined()
    expect(dahliaMoodBubbleStyle('neutral')).toBeUndefined()
    expect(dahliaMoodBubbleStyle('hungry')).toBeUndefined()
  })
})
