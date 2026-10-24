// Dahlia: records the microphone as a WAV file for the voice check (stores/dahlia-auth.ts), which Dahlia's
// server reads without any decoder: 16-bit PCM, mono, at the microphone's own rate. This file is Dahlia's
// (AIRI has no such file).

export interface DahliaRecording {
  /** Ends the recording and returns the WAV file. */
  stop: () => Promise<Blob>
  /** Ends the recording without a file. */
  cancel: () => void
}

/** Encodes mono samples (-1 to 1) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Starts recording the microphone. It stops by itself after maxSeconds; onLevel hears the loudness
 * (0 to 1) for a meter.
 */
export async function startDahliaRecording(options: { maxSeconds?: number, onLevel?: (level: number) => void, onAutoStop?: () => void } = {}): Promise<DahliaRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  // ScriptProcessorNode is deprecated but runs everywhere the apps do, without a worklet file.
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let finished = false

  processor.onaudioprocess = (event) => {
    if (finished)
      return
    const input = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
    let peak = 0
    for (const value of input)
      peak = Math.max(peak, Math.abs(value))
    options.onLevel?.(peak)
  }
  source.connect(processor)
  processor.connect(context.destination)

  function close() {
    finished = true
    processor.disconnect()
    source.disconnect()
    stream.getTracks().forEach(track => track.stop())
    void context.close()
  }

  const timer = setTimeout(() => options.onAutoStop?.(), (options.maxSeconds ?? 10) * 1000)

  return {
    async stop() {
      clearTimeout(timer)
      close()
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const samples = new Float32Array(length)
      let offset = 0
      for (const chunk of chunks) {
        samples.set(chunk, offset)
        offset += chunk.length
      }
      return encodeWav(samples, context.sampleRate)
    },
    cancel() {
      clearTimeout(timer)
      close()
    },
  }
}
