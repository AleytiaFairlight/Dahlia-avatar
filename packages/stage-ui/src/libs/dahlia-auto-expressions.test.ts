import { describe, expect, it, vi } from 'vitest'

import { AUTO_EXPRESSION_BACKOFF_MS, classifiableSentence, createDahliaAutoExpressions } from './dahlia-auto-expressions'

function setup(answers: Record<string, string | null | undefined | Promise<string | null | undefined>>) {
  let clock = 0
  const shown: string[] = []
  const classify = vi.fn(async (text: string) => await answers[text])
  const expressions = createDahliaAutoExpressions({
    classify,
    show: emotion => shown.push(emotion),
    enabled: () => true,
    now: () => clock,
  })
  const advance = (ms: number) => {
    clock += ms
  }
  return { expressions, shown, classify, advance }
}

describe('dahlia auto expressions', () => {
  it('shows the feeling of each sentence until the reply sets one itself', async () => {
    const { expressions, shown, classify } = setup({ 'You did it, well done!': 'happy', 'Oh, that is a shame.': 'sad', 'Anyway, see you later.': null })

    await expressions.spoken('t1', 'You did it, well done!')
    await expressions.spoken('t1', 'Anyway, see you later.')
    expressions.special('t1', '<|ACT {"emotion":"surprised"}|>')
    await expressions.spoken('t1', 'Oh, that is a shame.')

    expect(shown).toEqual(['happy'])
    expect(classify).toHaveBeenCalledTimes(2)

    expressions.ended('t1')
    await expressions.spoken('t2', 'Oh, that is a shame.')
    expect(shown).toEqual(['happy', 'sad'])
  })

  it('drops an answer that comes after the next sentence started', async () => {
    let answer!: (emotion: string) => void
    const { expressions, shown } = setup({ 'First sentence here.': new Promise(resolve => answer = resolve), 'Second sentence now.': 'think' })

    const first = expressions.spoken('t1', 'First sentence here.')
    await expressions.spoken('t1', 'Second sentence now.')
    answer('happy')
    await first

    expect(shown).toEqual(['think'])
  })

  it('stops asking for a while when her server can\'t answer', async () => {
    const { expressions, classify, advance } = setup({ 'Hello there, friend.': undefined })

    await expressions.spoken('t1', 'Hello there, friend.')
    await expressions.spoken('t1', 'Hello there, friend.')
    expect(classify).toHaveBeenCalledOnce()

    advance(AUTO_EXPRESSION_BACKOFF_MS)
    await expressions.spoken('t1', 'Hello there, friend.')
    expect(classify).toHaveBeenCalledTimes(2)
  })

  it('reads only sentences with words', () => {
    expect(classifiableSentence('...')).toBe(false)
    expect(classifiableSentence('Hm!')).toBe(false)
    expect(classifiableSentence('Okay sure')).toBe(true)
    expect(classifiableSentence('ありがとう')).toBe(true)
  })
})
