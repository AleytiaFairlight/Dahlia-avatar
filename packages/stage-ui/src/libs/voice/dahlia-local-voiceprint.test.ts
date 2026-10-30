// Dahlia: tests for dahlia-local-voiceprint.ts, the device's voiceprint from the voice check's recordings.
import { describe, expect, it } from 'vitest'

import { speechOf, to16k } from './dahlia-local-voiceprint'

describe('dahlia local voiceprint', () => {
  it('keeps only the windows scored as speech, and speech goes on through a short dip', async () => {
    // Four 512-sample windows: silence, speech, a dip, silence.
    const recording = new Float32Array(4 * 512)
    recording.fill(0.5, 512, 1024)
    recording.fill(0.25, 1024, 1536)
    const scores = [0.1, 0.9, 0.3, 0.05]
    let call = 0

    const speech = await speechOf([recording], async () => scores[call++], new AbortController().signal)

    expect(speech).toHaveLength(2 * 512)
    expect(speech[0]).toBe(0.5)
    expect(speech[600]).toBe(0.25)
  })

  it('turns 48 kHz into 16 kHz, without folding sound above 8 kHz back in', () => {
    const tone = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 48000))

    const out = to16k(tone, 48000)

    expect(out).toHaveLength(1600)
    expect(out[400]).toBeCloseTo(Math.sin(2 * Math.PI * 440 * 400 / 16000), 2)
    expect(to16k(out, 16000)).toBe(out)

    // 16 kHz at 48 kHz is above what 16 kHz holds: it averages away instead of becoming a low tone.
    const high = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(2 * Math.PI * 16000 * i / 48000))
    expect(Math.max(...to16k(high, 48000).slice(1, -1).map(Math.abs))).toBeLessThan(0.01)
  })
})
