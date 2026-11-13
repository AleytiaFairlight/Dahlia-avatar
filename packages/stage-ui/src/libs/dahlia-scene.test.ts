import { describe, expect, it } from 'vitest'

import { describeDahliaScene, parseDahliaScene, rgbFromRgba, sceneFocus } from './dahlia-scene'

const answer = JSON.stringify({
  scene: { setting: 'dark forest', style: 'video game' },
  objects: [
    { id: 1, name: 'knight', bbox: [400, 300, 600, 800], score: 0.9, mask: [1, 2] },
    { id: 2, name: 'health bar', bbox: [20, 20, 300, 60], score: 0.8 },
    { id: 3, name: 'sky', bbox: [0, 0, 1000, 1000], score: 0.95 },
    { id: 4, name: 'speck', bbox: [5, 5, 9, 9], score: 0.7 },
    { id: 5, name: 'ghost', bbox: [700, 300, 800, 500], score: 0.1 },
    { id: 6, name: 'broken', bbox: [9, 9, 3, 3], score: 0.9 },
  ],
  text: [],
  reasoning: 'lang: en | armored knight facing a large dragon in a dark forest | boss fights are common in games | cannot read the small text',
})

describe('dahlia scene', () => {
  it('reads what the model says: the description, and the things it is sure of', () => {
    const scene = parseDahliaScene(answer)!
    expect(scene.description).toBe('armored knight facing a large dragon in a dark forest; boss fights are common in games (dark forest, video game)')
    expect(scene.objects.map(object => object.name)).toEqual(['knight', 'health bar', 'sky', 'speck'])
    expect(describeDahliaScene(scene)).toBe(`Scene: ${scene.description}\nThings in it: knight, health bar, sky, speck`)
    expect(sceneFocus(scene)?.name, 'not the whole picture, not a speck').toBe('knight')
  })

  it('says nothing for an answer without content', () => {
    expect(parseDahliaScene('not json')).toBeUndefined()
    expect(parseDahliaScene('{"objects":[],"reasoning":"lang: en | cannot tell"}')).toBeUndefined()
    expect(parseDahliaScene('null')).toBeUndefined()
  })

  it('packs pixels as RGB', () => {
    expect([...rgbFromRgba(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0]))]).toEqual([1, 2, 3, 4, 5, 6])
  })
})
