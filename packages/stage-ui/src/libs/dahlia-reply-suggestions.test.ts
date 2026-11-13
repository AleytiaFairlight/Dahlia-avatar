import { describe, expect, it } from 'vitest'

import { cleanDahliaReplies } from './dahlia-reply-suggestions'

describe('dahlia reply suggestions', () => {
  it('keeps up to three short, different replies', () => {
    expect(cleanDahliaReplies(['Sounds  good!', 'sounds good!', 'What time?', 7, '', 'x'.repeat(91), 'Maybe later.', 'A fourth one'])).toEqual(['Sounds good!', 'What time?', 'Maybe later.'])
    expect(cleanDahliaReplies('nope')).toEqual([])
    expect(cleanDahliaReplies(undefined)).toEqual([])
  })
})
