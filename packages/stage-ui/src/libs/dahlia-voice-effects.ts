// Dahlia: effects on her voice. Her speech passes through a small chain of Web Audio nodes on its way to the
// speakers, chosen in Settings > Dahlia: none, soft (warmer and evened out), radio (narrow and a little rough),
// echo, or hall. It sits after the lip sync's tap, so her mouth follows the clean voice. The idea and the presets
// come from the audio studio of dasilva333/airi (packages/stage-ui/src/composables/audio/audio-effects.ts, MIT);
// the code is Dahlia's. Stage.vue connects it (scripts/apply_avatar_branding.sh adds the call). This file is Dahlia's.

export type DahliaVoiceEffect = 'none' | 'soft' | 'radio' | 'echo' | 'hall'

export const DAHLIA_VOICE_EFFECT_KEY = 'dahlia/voice-effect'
export const DAHLIA_VOICE_EFFECTS: Array<{ id: DahliaVoiceEffect, name: string }> = [
  { id: 'none', name: 'None' },
  { id: 'soft', name: 'Soft' },
  { id: 'radio', name: 'Radio' },
  { id: 'echo', name: 'Echo' },
  { id: 'hall', name: 'Hall' },
]

export function readDahliaVoiceEffect(raw: string | null | undefined): DahliaVoiceEffect {
  return DAHLIA_VOICE_EFFECTS.some(effect => effect.id === raw) ? raw as DahliaVoiceEffect : 'none'
}

/** A waveshaper curve that roughens the sound a little. */
function roughCurve(amount: number) {
  const curve = new Float32Array(256)
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / curve.length - 1
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x))
  }
  return curve
}

/**
 * Builds the nodes of an effect between `from` and `to`, and answers the function that takes them out again.
 * Every effect keeps the direct sound; echo and hall add delayed copies beside it.
 */
export function buildDahliaVoiceEffect(context: BaseAudioContext, effect: DahliaVoiceEffect, from: AudioNode, to: AudioNode) {
  const nodes: AudioNode[] = []
  const make = <Node extends AudioNode>(node: Node) => {
    nodes.push(node)
    return node
  }

  if (effect === 'soft') {
    const warm = make(context.createBiquadFilter())
    warm.type = 'lowpass'
    warm.frequency.value = 5200
    const body = make(context.createBiquadFilter())
    body.type = 'lowshelf'
    body.frequency.value = 220
    body.gain.value = 3
    const even = make(context.createDynamicsCompressor())
    even.threshold.value = -26
    even.ratio.value = 3
    from.connect(warm).connect(body).connect(even).connect(to)
  }
  else if (effect === 'radio') {
    const low = make(context.createBiquadFilter())
    low.type = 'highpass'
    low.frequency.value = 480
    const high = make(context.createBiquadFilter())
    high.type = 'lowpass'
    high.frequency.value = 3100
    const rough = make(context.createWaveShaper())
    rough.curve = roughCurve(6)
    const level = make(context.createGain())
    level.gain.value = 0.8
    from.connect(low).connect(high).connect(rough).connect(level).connect(to)
  }
  else if (effect === 'echo' || effect === 'hall') {
    const delay = make(context.createDelay(1))
    delay.delayTime.value = effect === 'echo' ? 0.19 : 0.07
    const feedback = make(context.createGain())
    feedback.gain.value = effect === 'echo' ? 0.28 : 0.55
    const wet = make(context.createGain())
    wet.gain.value = effect === 'echo' ? 0.35 : 0.3
    const dull = make(context.createBiquadFilter())
    dull.type = 'lowpass'
    dull.frequency.value = effect === 'echo' ? 4200 : 2600
    from.connect(to)
    from.connect(delay).connect(dull).connect(wet).connect(to)
    dull.connect(feedback).connect(delay)
  }
  else {
    from.connect(to)
  }

  return () => {
    try {
      from.disconnect(to)
    }
    catch {
      // Not connected directly in this effect.
    }
    for (const node of nodes)
      node.disconnect()
    if (nodes.length > 0) {
      try {
        from.disconnect(nodes[0])
      }
      catch {
        // Already taken out with the node.
      }
    }
  }
}

/**
 * Connects her speech to the speakers through the chosen effect, and changes it when the setting changes (also
 * from the settings window). Answers the function that disconnects it.
 */
export function connectDahliaVoiceEffects(context: BaseAudioContext, speech: AudioNode, destination: AudioNode = context.destination) {
  const read = () => {
    try {
      return readDahliaVoiceEffect(localStorage.getItem(DAHLIA_VOICE_EFFECT_KEY))
    }
    catch {
      return 'none' as const
    }
  }
  let current = read()
  let remove = buildDahliaVoiceEffect(context, current, speech, destination)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DAHLIA_VOICE_EFFECT_KEY)
      return
    const next = read()
    if (next === current)
      return
    remove()
    current = next
    remove = buildDahliaVoiceEffect(context, current, speech, destination)
  }
  globalThis.addEventListener?.('storage', onStorage)
  return () => {
    globalThis.removeEventListener?.('storage', onStorage)
    remove()
  }
}
