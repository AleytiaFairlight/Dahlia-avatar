<script setup lang="ts">
// Dahlia: shows the avatar auras in the 3D scene (see dahlia-auras.ts): it lives inside the model, like the
// presence bubble, follows the model's bones through the effects code in ../vfx (from dasilva333/airi, MIT) and
// starts an aura when one is triggered. ThreeScene.vue places it (scripts/apply_avatar_branding.sh adds it).
// This file is Dahlia's (AIRI has no such file).
import type { VRM } from '@pixiv/three-vrm'

import { useLoop, useTresContext } from '@tresjs/core'
import { onMounted, onUnmounted } from 'vue'

import { AuraController, frame, VrmSocketResolver } from '../vfx'
import { onDahliaAura } from './dahlia-auras'

const props = defineProps<{
  /** The loaded model, or undefined while there is none. */
  vrm: () => VRM | undefined
}>()

const { scene } = useTresContext()
const { onBeforeRender } = useLoop()

let controller: AuraController | undefined
let followed: VRM | undefined
let stopListening: (() => void) | undefined
// Nothing is built or updated until the first aura, and again once the last one faded.
let activeUntil = 0

function ensure() {
  if (!controller && scene.value)
    controller = new AuraController({ scene: scene.value })
  return controller
}

onMounted(() => {
  stopListening = onDahliaAura((kind, seconds) => {
    const auras = ensure()
    if (!auras)
      return
    auras.triggerAura(kind, seconds)
    // The effects fade out after their time; two more seconds let the last particles die.
    activeUntil = Math.max(activeUntil, frame.uTime.value + seconds + 2)
  })
})

onBeforeRender(({ delta }) => {
  if (!controller || frame.uTime.value > activeUntil)
    return
  const vrm = props.vrm()
  if (vrm !== followed) {
    followed = vrm
    controller.setResolver(vrm ? new VrmSocketResolver(vrm) : null)
  }
  frame.uTime.value += delta
  frame.uDelta.value = delta
  controller.update(delta)
})

onUnmounted(() => {
  stopListening?.()
  controller?.dispose()
  controller = undefined
})
</script>

<template>
  <slot />
</template>
