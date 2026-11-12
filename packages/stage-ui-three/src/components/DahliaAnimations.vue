<script setup lang="ts">
// Dahlia: plays the animations of the avatar's library on the 3D model (see dahlia-animations.ts): one at a time,
// faded in over the idle animation and back out when it ends. It lives inside the model, like the presence bubble.
// ThreeScene.vue places it (scripts/apply_avatar_branding.sh adds it). This file is Dahlia's.
import type { VRM } from '@pixiv/three-vrm'
import type { AnimationAction, AnimationClip, AnimationMixer } from 'three'

import { useLoop } from '@tresjs/core'
import { LoopOnce, LoopRepeat } from 'three'
import { onMounted, onUnmounted, toRaw } from 'vue'

import { clipFromVRMAnimation, loadVRMAnimation, reAnchorRootPositionTrack } from '../composables/vrm'
import {
  dahliaIdleAnimationNames,
  dahliaIdleAnimationsEnabled,
  findDahliaAnimation,
  listDahliaAnimations,
  nextDahliaIdleGap,
  onDahliaAnimationCommand,
  openDahliaAnimation,
  pickDahliaAnimation,
} from './dahlia-animations'

const props = defineProps<{
  /** The loaded model and its animation mixer, or undefined while there is none. */
  vrm: () => VRM | undefined
  mixer: () => AnimationMixer | undefined
}>()

const FADE_SECONDS = 0.5

const { onBeforeRender } = useLoop()

let names: string[] = []
let clipsOf: VRM | undefined
const clips = new Map<string, AnimationClip>()
let playing: { action: AnimationAction, mixer: AnimationMixer, base: AnimationAction[], onFinished: (event: { action: AnimationAction }) => void } | undefined
let lastIdle: string | undefined
let idleIn = nextDahliaIdleGap()
let stopListening: (() => void) | undefined
let request = 0

async function refresh() {
  try {
    names = (await listDahliaAnimations()).map(entry => entry.name)
  }
  catch (error) {
    console.warn('Dahlia: the animation library can\'t be read:', error)
    names = []
  }
}

async function clipFor(name: string, vrm: VRM) {
  if (clipsOf !== vrm) {
    clips.clear()
    clipsOf = vrm
  }
  const cached = clips.get(name)
  if (cached)
    return cached
  const source = await openDahliaAnimation(name)
  if (!source)
    return undefined
  try {
    const clip = await clipFromVRMAnimation(vrm, await loadVRMAnimation(source.url))
    if (!clip)
      return undefined
    reAnchorRootPositionTrack(clip, vrm)
    // The face stays with her expressions and her lip sync.
    clip.tracks = clip.tracks.filter(track => !track.name.includes('blendShapes') && !track.name.includes('expressions'))
    clips.set(name, clip)
    return clip
  }
  finally {
    source.release()
  }
}

/** Fades the animation out and the idle animation back in. */
function stop() {
  request++
  const ended = playing
  if (!ended)
    return
  playing = undefined
  ended.mixer.removeEventListener('finished', ended.onFinished)
  ended.action.fadeOut(FADE_SECONDS)
  for (const action of ended.base)
    action.reset().fadeIn(FADE_SECONDS).play()
  setTimeout(() => ended.action.stop(), FADE_SECONDS * 1000 + 100)
  idleIn = nextDahliaIdleGap()
}

async function play(asked: string, loop = false) {
  const vrm = props.vrm()
  // The model keeps its mixer in a ref; the mixer itself is what its actions are compared with.
  const mixer = toRaw(props.mixer())
  const name = findDahliaAnimation(names, asked)
  if (!vrm || !mixer || !name)
    return
  const mine = ++request
  const clip = await clipFor(name, vrm).catch((error) => {
    console.warn(`Dahlia: the animation ${name} can't be played:`, error)
    return undefined
  })
  // Another request, or another model, came in the meantime.
  if (!clip || mine !== request || props.vrm() !== vrm || toRaw(props.mixer()) !== mixer)
    return

  const action = mixer.clipAction(clip)
  // What plays now (the idle animation, or an animation of the library) makes room; the idle one returns later.
  const running = ((mixer as unknown as { _actions?: AnimationAction[] })._actions ?? []).filter(other => other !== action && other.isRunning())
  const base = playing ? playing.base : running
  if (playing) {
    playing.mixer.removeEventListener('finished', playing.onFinished)
    const before = playing.action
    if (before !== action) {
      before.fadeOut(FADE_SECONDS)
      setTimeout(() => before.stop(), FADE_SECONDS * 1000 + 100)
    }
  }
  else {
    for (const other of base)
      other.fadeOut(FADE_SECONDS)
  }

  action.reset()
  action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1)
  action.clampWhenFinished = !loop
  action.setEffectiveWeight(1).fadeIn(FADE_SECONDS).play()
  const onFinished = (event: { action: AnimationAction }) => {
    if (event.action === action)
      stop()
  }
  mixer.addEventListener('finished', onFinished)
  playing = { action, mixer, base, onFinished }
}

onMounted(() => {
  void refresh()
  stopListening = onDahliaAnimationCommand((command) => {
    if (command.op === 'changed')
      void refresh()
    else if (command.op === 'stop')
      stop()
    else
      void play(command.name, command.loop === true)
  })
})

// Now and then while she idles, an animation of the library, so she doesn't stand the same way all day.
onBeforeRender(({ delta }) => {
  if (playing && toRaw(props.mixer()) !== playing.mixer)
    playing = undefined
  if (playing || names.length === 0)
    return
  idleIn -= delta
  if (idleIn > 0)
    return
  idleIn = nextDahliaIdleGap()
  if (!dahliaIdleAnimationsEnabled())
    return
  lastIdle = pickDahliaAnimation(dahliaIdleAnimationNames(names), lastIdle)
  if (lastIdle)
    void play(lastIdle)
})

onUnmounted(() => {
  stopListening?.()
  stop()
})
</script>

<template>
  <slot />
</template>
