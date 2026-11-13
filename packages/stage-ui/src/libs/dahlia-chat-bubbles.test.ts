import { describe, expect, it } from 'vitest'

import { CHAT_BUBBLES_MAX, splitDahliaBubbles } from './dahlia-chat-bubbles'

describe('dahlia chat bubbles', () => {
  it('gives each thought its own bubble and leaves a short or single-paragraph message whole', () => {
    const text = 'Oh, that sounds like a long day at the hospital again.\n\nDid you at least get to eat something before the night shift started?\n\nI kept the notes from yesterday, if you want to go on with the cello piece.'
    expect(splitDahliaBubbles(text)).toEqual(text.split('\n\n'))
    expect(splitDahliaBubbles('Sure!\n\nDone.')).toEqual(['Sure!\n\nDone.'])
    const single = 'One long paragraph without any blank line in it, which goes on for a good while and says everything at once.'
    expect(splitDahliaBubbles(single)).toEqual([single])
  })

  it('never splits a code block, and keeps a list with the line that introduces it', () => {
    const code = 'Here is the script you asked for, it only needs Python:\n\n```python\nprint("a")\n\nprint("b")\n```\n\nRun it from the folder with the pictures and tell me what it prints.'
    const bubbles = splitDahliaBubbles(code)
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0]).toContain('print("a")\n\nprint("b")')
    expect(bubbles.join('\n\n')).toBe(code)

    const list = 'I found three things worth doing before the trip to Lisbon next month.\n\n- book the flights\n- ask Mira about the keys\n\n1. and then pack\n\nThat should be all, unless the weather turns.'
    expect(splitDahliaBubbles(list)).toEqual([
      'I found three things worth doing before the trip to Lisbon next month.\n\n- book the flights\n- ask Mira about the keys\n\n1. and then pack',
      'That should be all, unless the weather turns.',
    ])
  })

  it('keeps a heading with what follows, joins a short opener, and gathers too many into the last bubble', () => {
    const heading = '## The plan for the weekend\n\nSaturday is for the balcony and the tomatoes, Sunday for the bread with your mother.\n\nOkay.\n\nAnd on Monday we look at the rent letter together, before the landlord calls again.'
    expect(splitDahliaBubbles(heading)).toEqual([
      '## The plan for the weekend\n\nSaturday is for the balcony and the tomatoes, Sunday for the bread with your mother.',
      'Okay.\n\nAnd on Monday we look at the rent letter together, before the landlord calls again.',
    ])

    const many = Array.from({ length: 9 }, (_, i) => `This is paragraph number ${i} and it is long enough to stand alone.`).join('\n\n')
    const bubbles = splitDahliaBubbles(many)
    expect(bubbles).toHaveLength(CHAT_BUBBLES_MAX)
    expect(bubbles.join('\n\n')).toBe(many)
    expect(bubbles[0]).toBe('This is paragraph number 0 and it is long enough to stand alone.')
  })
})
