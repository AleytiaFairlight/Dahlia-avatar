// Dahlia: this device's voiceprint (the voiceprint store, which speaker recognition in voice chat compares with),
// made from the sentences read in Dahlia's voice check, so a person binds their voice once: the check's dialog
// records it on her server and here. This file is Dahlia's (AIRI has no such file).
import type { AudioWindow } from '@proj-airi/pipelines-audio'

import { useVoiceprintStore } from '../../stores/voiceprint'
import { SileroVad } from '../../workers/vad/silero-vad'
import { computeVoiceprint } from './speaker-model'
import { MIN_ENROLLMENT_SPEECH_SECONDS } from './voice-enrollment'

const RATE = 16000
const WINDOW = 512
// The voice enrollment's (libs/voice/voice-enrollment.ts): a window starts speech at this score, and speech goes
// on while the score stays at 30 percent of it.
const SPEECH_START_SCORE = 0.6
const SPEECH_CONTINUE_SCORE = SPEECH_START_SCORE * 0.3

/**
 * Mono samples at the microphone's rate as 16 kHz: each output sample is the mean of the input around it, which keeps
 * sound above 8 kHz from folding back into the speech band.
 */
export function to16k(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === RATE)
    return samples
  const ratio = sampleRate / RATE
  const half = Math.max(0.5, ratio / 2)
  const out = new Float32Array(Math.floor(samples.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const center = i * ratio
    const from = Math.max(0, Math.ceil(center - half))
    const to = Math.min(samples.length - 1, Math.floor(center + half))
    let sum = 0
    for (let j = from; j <= to; j++)
      sum += samples[j]
    out[i] = sum / (to - from + 1)
  }
  return out
}

/** The speech in recordings at 16 kHz: the windows a detector scores as speech, joined. */
export async function speechOf(recordings: Float32Array[], detect: (window: AudioWindow, signal: AbortSignal) => Promise<number>, signal: AbortSignal): Promise<Float32Array> {
  const kept: Float32Array[] = []
  let total = 0
  for (const recording of recordings) {
    let speaking = false
    for (let start = 0; start + WINDOW <= recording.length; start += WINDOW) {
      const samples = recording.slice(start, start + WINDOW)
      const window: AudioWindow = {
        range: { sourceId: 'dahlia-voice-check', startFrame: start, endFrame: start + WINDOW },
        sampleRate: RATE,
        channels: [samples],
        discontinuity: start === 0,
      }
      const score = await detect(window, signal)
      speaking = score >= (speaking ? SPEECH_CONTINUE_SCORE : SPEECH_START_SCORE)
      if (speaking) {
        kept.push(samples)
        total += samples.length
      }
    }
  }

  const speech = new Float32Array(total)
  let offset = 0
  for (const samples of kept) {
    speech.set(samples, offset)
    offset += samples.length
  }
  return speech
}

/**
 * Saves this device's voiceprint from voice check recordings. `too-short` when they hold less speech than an
 * enrollment needs; it throws when the voice models fail (they may need a download).
 */
export async function saveDahliaLocalVoiceprint(recordings: { samples: Float32Array, sampleRate: number }[], signal: AbortSignal): Promise<'saved' | 'too-short'> {
  const startedAt = Date.now()
  const vad = new SileroVad()
  let speech: Float32Array
  try {
    speech = await speechOf(recordings.map(r => to16k(r.samples, r.sampleRate)), (window, s) => vad.score(window, s), signal)
  }
  finally {
    void vad.close()
  }

  if (speech.length < MIN_ENROLLMENT_SPEECH_SECONDS * RATE)
    return 'too-short'
  const voiceprint = await computeVoiceprint(speech, RATE, signal)
  signal.throwIfAborted()
  if (!useVoiceprintStore().save(voiceprint, startedAt))
    throw new Error('The voiceprint was deleted meanwhile')
  return 'saved'
}
