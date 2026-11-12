import type { DahliaScreenWord } from './dahlia-game-player'

import { describe, expect, it } from 'vitest'

import { changedBox, focusRegion, wordSet, zoneOf } from './dahlia-screen-focus'

/** A 16x16 thumbnail, dark, with the given cells bright. */
function thumbnail(bright: Array<[number, number]> = []) {
  const cells = Array.from<number>({ length: 256 }).fill(10)
  for (const [x, y] of bright)
    cells[y * 16 + x] = 200
  return btoa(String.fromCharCode(...cells))
}

function line(text: string, l: number, x: number, y: number): DahliaScreenWord[] {
  return text.split(' ').map((t, index) => ({ t, x: x + index * 60, y, w: 50, h: 18, l }))
}

describe('dahlia screen focus', () => {
  it('finds the part of the picture that changed and names where it is', () => {
    expect(changedBox(thumbnail(), thumbnail())).toBeUndefined()
    expect(changedBox(undefined, thumbnail())).toBeUndefined()
    const box = changedBox(thumbnail(), thumbnail([[12, 13], [14, 14]]))!
    expect(box).toEqual({ x1: 750, y1: 813, x2: 938, y2: 938 })
    expect(zoneOf(box)).toBe('bottom right')
    expect(zoneOf({ x1: 400, y1: 400, x2: 600, y2: 600 })).toBe('center')
    expect(zoneOf({ x1: 0, y1: 400, x2: 200, y2: 600 })).toBe('left')
  })

  it('looks at the line that caused the look, with the lines around it', () => {
    const words = [
      ...line('File Edit View', 0, 10, 10),
      ...line('Build failed with 1 error', 1, 40, 700),
      ...line('error CS0103: The name x', 2, 40, 725),
      ...line('Ready', 3, 900, 980),
    ]
    const region = focusRegion({ words, line: 'Build failed with 1 error', before: thumbnail(), after: thumbnail([[1, 1]]) })!
    expect(region.from).toBe('line')
    expect(region.zone).toBe('bottom left')
    expect(region.box.y1).toBeLessThan(700)
    expect(region.box.y2).toBeGreaterThan(743)
    expect(region.box.y1, 'the menu at the top is not part of it').toBeGreaterThan(100)
  })

  it('looks at the text that is new, then at the changed picture, and at nothing when it is most of the screen', () => {
    const old = [...line('Inbox Sent Drafts', 0, 10, 10), ...line('No new mail', 1, 300, 300)]
    const now = [...old, ...line('Download complete: setup.exe', 2, 600, 900)]
    expect(focusRegion({ words: now, known: wordSet(old) })).toMatchObject({ from: 'new-text', zone: 'bottom right' })

    // A game: no words, a corner of the picture changed.
    expect(focusRegion({ words: [], known: new Set(), before: thumbnail(), after: thumbnail([[0, 0], [2, 1]]) })).toMatchObject({ from: 'picture', zone: 'top left' })

    // Everything changed: the whole picture shows it.
    const everywhere = Array.from({ length: 16 }, (_, i): [number, number] => [i, i])
    expect(focusRegion({ before: thumbnail(), after: thumbnail(everywhere) })).toBeUndefined()
    expect(focusRegion({ words: now, known: wordSet(now) })).toBeUndefined()
  })

  it('never gives a region smaller than the least size or outside the screen', () => {
    const region = focusRegion({ before: thumbnail(), after: thumbnail([[15, 15]]) })!
    expect(region.box.x2).toBe(1000)
    expect(region.box.y2).toBe(1000)
    expect(region.box.x2 - region.box.x1).toBeGreaterThanOrEqual(260)
    expect(region.box.y2 - region.box.y1).toBeGreaterThanOrEqual(160)
  })
})
