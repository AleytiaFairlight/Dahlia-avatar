import { describe, expect, it } from 'vitest'

import { DahliaScreenAttention, matchInterests, matchProblems, parseInterests, SCREEN_LOOK_GAP_GAME_MS, SCREEN_LOOKS_PER_HOUR } from './dahlia-screen-attention'

function attention(interests: string[] = []) {
  let clock = 1_000_000
  const instance = new DahliaScreenAttention({ interests: () => interests, now: () => clock })
  const pass = (ms: number) => {
    clock += ms
  }
  return { instance, pass }
}

const editor = { window: 'Program.cs - Code (Code)', text: 'using System\nnamespace Dahlia\npublic class Program\nstatic void Main args' }

describe('dahlia screen attention', () => {
  it('looks first, then only when the window, the text or a problem is new', () => {
    const { instance, pass } = attention()
    expect(instance.judge(editor)).toMatchObject({ look: true, reason: 'first' })
    instance.noted(editor)
    pass(15_000)

    expect(instance.judge({ ...editor, text: `${editor.text}\nConsole WriteLine` })).toMatchObject({ look: false, reason: 'quiet' })
    expect(instance.judge({ window: 'Inbox - Mail (thunderbird)', text: editor.text })).toMatchObject({ look: true, reason: 'window' })
    expect(instance.judge({ ...editor, text: 'Welcome back\nYour orders\nTrack package\nBuy again' })).toMatchObject({ look: true, reason: 'text' })

    const broken = { ...editor, text: `${editor.text}\nBuild failed with 1 error\nerror CS0103: The name x does not exist` }
    expect(instance.judge(broken)).toMatchObject({ look: true, reason: 'problem', focus: 'Build failed with 1 error' })
    instance.noted(broken)
    pass(15_000)
    expect(instance.judge({ ...broken, text: `${broken.text}\n1 Warning` }), 'the same problem is not news').toMatchObject({ look: false, reason: 'quiet' })
    expect(instance.judge(broken, { force: true })).toMatchObject({ look: true, reason: 'refresh' })
  })

  it('looks at once for a word the person asked her to watch for, also misread or in the window title', () => {
    const { instance, pass } = attention(['download complete', 'boss'])
    instance.noted(editor)
    pass(3000)
    expect(instance.judge({ ...editor, text: `${editor.text}\nDownlaod complete - 4.2 GB` })).toMatchObject({ look: true, reason: 'interest', focus: 'download complete: Downlaod complete - 4.2 GB' })
    expect(instance.judge({ window: 'Boss fight - Game (game)', text: editor.text })).toMatchObject({ look: true, reason: 'interest' })
    expect(matchInterests('The embossed cover', ['boss']), 'a short word must stand alone').toEqual([])
    expect(matchProblems('No errors. Nothing failed.')).toHaveLength(2)
  })

  it('leaves a pause between looks at a game and stops at the hourly limit', () => {
    const { instance, pass } = attention()
    instance.noted({ text: 'Level 3\nScore 100\nLives 2\nStage Forest Path' })
    pass(1000)
    const next = { text: 'Shop\nBuy sword\nGold 40\nLeave' }
    expect(instance.judge(next, { game: true })).toMatchObject({ look: false, reason: 'too-soon' })
    pass(SCREEN_LOOK_GAP_GAME_MS)
    expect(instance.judge(next, { game: true })).toMatchObject({ look: true, reason: 'text' })
    expect(instance.judge({}, { game: true }), 'no text read: the changed picture decides').toMatchObject({ look: true, reason: 'picture' })
    instance.noted({ text: 'HP 40' })
    pass(SCREEN_LOOK_GAP_GAME_MS)
    expect(instance.judge({ text: '' }, { game: true }), 'hardly any text: the changed picture decides').toMatchObject({ look: true, reason: 'picture' })

    for (let i = 0; i < SCREEN_LOOKS_PER_HOUR; i++)
      instance.noted({ text: 'Level 3\nScore 100' })
    pass(20_000)
    expect(instance.judge(next)).toMatchObject({ look: false, reason: 'limit' })
    pass(3_600_000)
    expect(instance.judge(next)).toMatchObject({ look: true })
  })

  it('reads the words to watch for from a list or a text', () => {
    expect(parseInterests('build failed, Boss\nboss, x,  low   health ')).toEqual(['build failed', 'Boss', 'low health'])
    expect(parseInterests(['a', 42, 'victory'])).toEqual(['victory'])
    expect(parseInterests(undefined)).toEqual([])
  })
})
