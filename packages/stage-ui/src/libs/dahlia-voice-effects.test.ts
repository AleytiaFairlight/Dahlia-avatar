import type { DahliaVoiceEffect } from './dahlia-voice-effects'

import { describe, expect, it } from 'vitest'

import { buildDahliaVoiceEffect, DAHLIA_VOICE_EFFECTS, readDahliaVoiceEffect } from './dahlia-voice-effects'

/** A stand-in audio graph that records its connections. */
function graph() {
  const links = new Set<string>()
  let count = 0
  const node = (name: string) => {
    const self: any = {
      name,
      type: '',
      curve: undefined,
      frequency: { value: 0 },
      gain: { value: 0 },
      threshold: { value: 0 },
      ratio: { value: 0 },
      delayTime: { value: 0 },
      connect(to: any) {
        links.add(`${name}>${to.name}`)
        return to
      },
      disconnect(to?: any) {
        for (const link of [...links]) {
          if (link.startsWith(`${name}>`) && (!to || link === `${name}>${to.name}`))
            links.delete(link)
        }
      },
    }
    return self
  }
  const make = (kind: string) => () => node(`${kind}${++count}`)
  const context: any = {
    createBiquadFilter: make('filter'),
    createDynamicsCompressor: make('compressor'),
    createWaveShaper: make('shaper'),
    createGain: make('gain'),
    createDelay: make('delay'),
  }
  return { context, links, from: node('speech'), to: node('out') }
}

/** Whether the speech reaches the output through the links. */
function reaches(links: Set<string>) {
  const seen = new Set(['speech'])
  for (let grew = true; grew;) {
    grew = false
    for (const link of links) {
      const [a, b] = link.split('>')
      if (seen.has(a) && !seen.has(b)) {
        seen.add(b)
        grew = true
      }
    }
  }
  return seen.has('out')
}

describe('dahlia voice effects', () => {
  it('lets the voice through every effect and leaves nothing connected when taken out', () => {
    for (const { id } of DAHLIA_VOICE_EFFECTS) {
      const { context, links, from, to } = graph()
      const remove = buildDahliaVoiceEffect(context, id, from, to)
      expect(reaches(links), id).toBe(true)
      remove()
      expect([...links], id).toEqual([])
    }
  })

  it('keeps the direct sound beside an echo, and plain speech has no nodes', () => {
    const echo = graph()
    buildDahliaVoiceEffect(echo.context, 'echo', echo.from, echo.to)
    expect(echo.links.has('speech>out')).toBe(true)
    expect([...echo.links].some(link => link.startsWith('gain') && link.includes('>delay')), 'the echo feeds back').toBe(true)

    const none = graph()
    buildDahliaVoiceEffect(none.context, 'none', none.from, none.to)
    expect([...none.links]).toEqual(['speech>out'])
  })

  it('reads the setting', () => {
    expect(readDahliaVoiceEffect('radio')).toBe<DahliaVoiceEffect>('radio')
    expect(readDahliaVoiceEffect('robot')).toBe<DahliaVoiceEffect>('none')
    expect(readDahliaVoiceEffect(null)).toBe<DahliaVoiceEffect>('none')
  })
})
