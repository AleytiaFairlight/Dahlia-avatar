import { describe, expect, it } from 'vitest'

import { DAHLIA_ANIMATION_DANCES, DAHLIA_ANIMATION_IDLE_MAX_SECONDS, DAHLIA_ANIMATION_IDLE_MIN_SECONDS, dahliaAnimationName, dahliaIdleAnimationNames, findDahliaAnimation, listDahliaAnimations, nextDahliaIdleGap, onDahliaAnimationCommand, openDahliaAnimation, pickDahliaAnimation, sendDahliaAnimationCommand } from './dahlia-animations'

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

  it('comes with the built-in animations and keeps the dances out of idle play unless chosen', async () => {
    const names = (await listDahliaAnimations()).map(entry => entry.name)
    expect(names).toHaveLength(23)
    expect(names).toContain('peace_sign')
    expect(names).not.toContain('idle_loop')
    expect((await openDahliaAnimation('crab_dance'))?.url).toMatch(/crab_dance\.vrma$/)
    expect(await openDahliaAnimation('nothing')).toBeUndefined()

    const idle = dahliaIdleAnimationNames(names, null)
    expect(idle).toContain('peace_sign')
    expect(idle).not.toContain('crab_dance')
    expect(DAHLIA_ANIMATION_DANCES.every(name => names.includes(name))).toBe(true)
    expect(dahliaIdleAnimationNames(names, '["crab_dance","gone"]')).toEqual(['crab_dance'])
    expect(dahliaIdleAnimationNames(names, '[]')).toEqual([])
    expect(dahliaIdleAnimationNames(names, 'broken')).toEqual(idle)
  })

  it('carries commands to the scenes that listen', async () => {
    const received = new Promise(resolve => onDahliaAnimationCommand(resolve))
    sendDahliaAnimationCommand({ op: 'play', name: 'peace_sign' })
    expect(await received).toEqual({ op: 'play', name: 'peace_sign' })
  })
})
