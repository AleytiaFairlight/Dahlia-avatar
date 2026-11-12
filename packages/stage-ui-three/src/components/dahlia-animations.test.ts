import { describe, expect, it } from 'vitest'

import { DAHLIA_ANIMATION_IDLE_MAX_SECONDS, DAHLIA_ANIMATION_IDLE_MIN_SECONDS, dahliaAnimationName, findDahliaAnimation, nextDahliaIdleGap, onDahliaAnimationCommand, pickDahliaAnimation, sendDahliaAnimationCommand } from './dahlia-animations'

describe('dahlia animations', () => {
  it('names an animation after its file and finds it however it is written', () => {
    expect(dahliaAnimationName('Crab Dance (v2).VRMA')).toBe('crab_dance_v2')
    expect(dahliaAnimationName('  ピース.vrma')).toBe('ピース')
    expect(dahliaAnimationName('.vrma')).toBe('')
    const names = ['crab_dance_v2', 'peace_sign']
    expect(findDahliaAnimation(names, 'crabDanceV2')).toBe('crab_dance_v2')
    expect(findDahliaAnimation(names, 'Peace Sign.vrma')).toBe('peace_sign')
    expect(findDahliaAnimation(names, 'wave')).toBeUndefined()
    expect(findDahliaAnimation(names, '')).toBeUndefined()
  })

  it('picks another animation than the last one, some time between the idle limits', () => {
    expect(pickDahliaAnimation(['a', 'b'], 'a', () => 0)).toBe('b')
    expect(pickDahliaAnimation(['a'], 'a', () => 0.99)).toBe('a')
    expect(pickDahliaAnimation([], undefined)).toBeUndefined()
    expect(nextDahliaIdleGap(() => 0)).toBe(DAHLIA_ANIMATION_IDLE_MIN_SECONDS)
    expect(nextDahliaIdleGap(() => 1)).toBe(DAHLIA_ANIMATION_IDLE_MAX_SECONDS)
  })

  it('carries commands to the scenes that listen', async () => {
    const received = new Promise(resolve => onDahliaAnimationCommand(resolve))
    sendDahliaAnimationCommand({ op: 'play', name: 'peace_sign' })
    expect(await received).toEqual({ op: 'play', name: 'peace_sign' })
  })
})
