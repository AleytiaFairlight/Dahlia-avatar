import { describe, expect, it } from 'vitest'

import { readActEmotion } from './act-emotion'

describe('readActEmotion', () => {
  it('reads the emotion of an ACT marker', () => {
    expect(readActEmotion('<|ACT {"emotion":"happy"}|>')).toBe('happy')
    expect(readActEmotion('<|ACT {"emotion":{"name":"Surprised","intensity":0.6}}|>')).toBe('surprised')
    expect(readActEmotion(' <|ACT {"emotion":"sad","motion":"nod"}|> ')).toBe('sad')
  })

  it('has no emotion for neutral, motions only, other markers and broken markers', () => {
    expect(readActEmotion('<|ACT {"emotion":"neutral"}|>')).toBeUndefined()
    expect(readActEmotion('<|ACT {"motion":"wave"}|>')).toBeUndefined()
    expect(readActEmotion('<|DELAY 1|>')).toBeUndefined()
    expect(readActEmotion('<|ACT {emotion: happy}|>')).toBeUndefined()
    expect(readActEmotion('<|ACT ["happy"]|>')).toBeUndefined()
  })
})
