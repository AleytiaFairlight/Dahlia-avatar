import { describe, expect, it, vi } from 'vitest'

import { onDahliaStickerSlap, placeStickerSlap, startDahliaStickerSlaps, stickerOfSpecial } from './dahlia-sticker-slap'

describe('dahlia sticker slaps', () => {
  it('reads the sticker of a marker and nothing from other markers', () => {
    expect(stickerOfSpecial('<|STICKER airi-happy|>')).toBe('airi-happy')
    expect(stickerOfSpecial(' <|STICKER my-cat-2|> ')).toBe('my-cat-2')
    expect(stickerOfSpecial('<|ACT:{"emotion":"happy"}|>')).toBeUndefined()
    expect(stickerOfSpecial('<|STICKER ../evil|>')).toBeUndefined()
  })

  it('lands beside her, left and right in turn, never in the middle', () => {
    for (const random of [() => 0, () => 0.5, () => 0.999]) {
      const right = placeStickerSlap(0, random)
      const left = placeStickerSlap(1, random)
      expect(right.left).toBeGreaterThanOrEqual(74)
      expect(left.left).toBeLessThanOrEqual(26)
      expect(right.top).toBeGreaterThanOrEqual(18)
      expect(right.top).toBeLessThanOrEqual(58)
      expect(Math.abs(right.turn)).toBeLessThanOrEqual(14)
    }
  })

  it('slaps the sticker of her answer onto the stages that listen', async () => {
    const stage = vi.fn()
    const stop = onDahliaStickerSlap(stage)
    let hook: (special: string) => Promise<void> = async () => {}
    startDahliaStickerSlaps((callback) => {
      hook = callback
      return () => {}
    })
    await hook('<|STICKER airi-celebrate|>')
    await hook('<|DELAY 1|>')
    expect(stage.mock.calls).toEqual([['airi-celebrate']])
    stop()
  })
})
