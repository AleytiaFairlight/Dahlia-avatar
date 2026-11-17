import { describe, expect, it } from 'vitest'

import { DAHLIA_ANIMATION_IDLE_MAX_SECONDS, DAHLIA_ANIMATION_IDLE_MIN_SECONDS, dahliaAnimationName, dahliaIdleAnimationNames, dahliaServerAnimations, downloadDahliaServerAnimations, findDahliaAnimation, listDahliaAnimations, nextDahliaIdleGap, onDahliaAnimationCommand, openDahliaAnimation, pickDahliaAnimation, sendDahliaAnimationCommand, setDahliaAnimationServer } from './dahlia-animations'

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

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

  it('keeps the dances out of idle play unless chosen', () => {
    const names = ['agent_007', 'crab_dance', 'peace_sign', 'tetris']
    const idle = dahliaIdleAnimationNames(names, null)
    expect(idle).toEqual(['agent_007', 'peace_sign'])
    expect(dahliaIdleAnimationNames(names, '["crab_dance","gone"]')).toEqual(['crab_dance'])
    expect(dahliaIdleAnimationNames(names, '[]')).toEqual([])
    expect(dahliaIdleAnimationNames(names, 'broken')).toEqual(idle)
  })

  it('lists the server\'s animations and downloads one the first time it plays, checking its hash', async () => {
    const crab = new Uint8Array([1, 2, 3])
    const downloads: string[] = []
    setDahliaAnimationServer({
      list: async () => [
        { name: 'crab_dance', bytes: 3, sha256: await sha256(crab) },
        { name: 'peace_sign', bytes: 1, sha256: 'f'.repeat(64) },
        { name: '../not plain', bytes: 1, sha256: 'f'.repeat(64) },
      ],
      download: async (name) => {
        downloads.push(name)
        return new Blob([name === 'crab_dance' ? crab : new Uint8Array([9])])
      },
    })
    try {
      const entries = await listDahliaAnimations()
      expect(entries.map(entry => entry.name)).toEqual(['crab_dance', 'peace_sign'])
      expect(entries.every(entry => entry.builtIn)).toBe(true)
      expect(entries[0].bytes).toBe(3)

      const opened = await openDahliaAnimation('crab_dance')
      expect(opened?.url).toMatch(/^blob:/)
      opened?.release()
      expect(downloads).toEqual(['crab_dance'])
      expect(await openDahliaAnimation('peace_sign'), 'a file that doesn\'t match its hash').toBeUndefined()
      expect(await openDahliaAnimation('nothing')).toBeUndefined()
    }
    finally {
      setDahliaAnimationServer(undefined)
    }
  })

  it('has no server animations without a server, and asks again after a failure', async () => {
    expect(await dahliaServerAnimations()).toEqual([])
    let calls = 0
    setDahliaAnimationServer({
      list: async () => {
        calls++
        if (calls === 1)
          throw new Error('offline')
        return [{ name: 'shy', bytes: 1, sha256: 'a'.repeat(64) }]
      },
      download: async () => new Blob([]),
    })
    try {
      expect(await dahliaServerAnimations()).toEqual([])
      expect((await dahliaServerAnimations()).map(entry => entry.name)).toEqual(['shy'])
      await dahliaServerAnimations()
      expect(calls, 'once per run after it answered').toBe(2)
    }
    finally {
      setDahliaAnimationServer(undefined)
    }
  })

  it('downloads every server animation ahead of play, and says when the device has them all', async () => {
    const bow = new Uint8Array([4, 5])
    const wave = new Uint8Array([6])
    const downloads: string[] = []
    let waveFails = true
    setDahliaAnimationServer({
      list: async () => [
        { name: 'bow', bytes: 2, sha256: await sha256(bow) },
        { name: 'wave', bytes: 1, sha256: await sha256(wave) },
      ],
      download: async (name) => {
        downloads.push(name)
        if (name === 'wave' && waveFails)
          throw new Error('offline')
        return new Blob([name === 'bow' ? bow : wave])
      },
    })
    try {
      expect(await downloadDahliaServerAnimations(), 'one download failed: try again later').toBe(false)
      expect(downloads).toEqual(['bow', 'wave'])
      waveFails = false
      expect(await downloadDahliaServerAnimations()).toBe(true)
      expect(downloads).toContain('wave')
    }
    finally {
      setDahliaAnimationServer(undefined)
    }
  })

  it('downloads nothing while the server doesn\'t answer, and not a file that doesn\'t match its hash', async () => {
    const downloads: string[] = []
    setDahliaAnimationServer({
      list: async () => {
        throw new Error('Dahlia\'s key isn\'t set.')
      },
      download: async (name) => {
        downloads.push(name)
        return new Blob([])
      },
    })
    try {
      expect(await downloadDahliaServerAnimations()).toBe(false)
      expect(downloads).toEqual([])
    }
    finally {
      setDahliaAnimationServer(undefined)
    }

    setDahliaAnimationServer({
      list: async () => [{ name: 'spin', bytes: 1, sha256: 'b'.repeat(64) }],
      download: async () => new Blob([new Uint8Array([1])]),
    })
    try {
      expect(await downloadDahliaServerAnimations(), 'the file is not the one listed').toBe(false)
    }
    finally {
      setDahliaAnimationServer(undefined)
    }
  })

  it('carries commands to the scenes that listen', async () => {
    const received = new Promise(resolve => onDahliaAnimationCommand(resolve))
    sendDahliaAnimationCommand({ op: 'play', name: 'peace_sign' })
    expect(await received).toEqual({ op: 'play', name: 'peace_sign' })
  })
})
