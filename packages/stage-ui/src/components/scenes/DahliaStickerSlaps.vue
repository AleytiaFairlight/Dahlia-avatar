<script setup lang="ts">
// Dahlia: the stickers slapped onto her stage (libs/dahlia-sticker-slap.ts). They lie over the stage without
// taking clicks, beside her avatar. Stage.vue places this (scripts/apply_avatar_branding.sh adds it).
// This file is Dahlia's (AIRI has no such file).
import type { DahliaStickerSlap } from '../../libs/dahlia-sticker-slap'

import { onBeforeUnmount, onMounted, ref } from 'vue'

import { onDahliaStickerSlap, placeStickerSlap, STICKER_SLAP_MS, STICKER_SLAPS_MAX } from '../../libs/dahlia-sticker-slap'
import { useStickersStore } from '../../stores/modules/stickers'

const stickers = useStickersStore()
const slaps = ref<DahliaStickerSlap[]>([])
let count = 0
let stop: (() => void) | undefined
const timers = new Set<ReturnType<typeof setTimeout>>()

onMounted(() => {
  // The artwork of her own stickers is read from the app's storage; the built-in ones are there at once.
  void Promise.resolve(stickers.load()).catch(() => {})
  stop = onDahliaStickerSlap((stickerId) => {
    if (!stickers.artwork[stickerId])
      return
    const slap: DahliaStickerSlap = { key: ++count, stickerId, ...placeStickerSlap(count) }
    slaps.value = [...slaps.value, slap].slice(-STICKER_SLAPS_MAX)
    const timer = setTimeout(() => {
      timers.delete(timer)
      slaps.value = slaps.value.filter(other => other.key !== slap.key)
    }, STICKER_SLAP_MS)
    timers.add(timer)
  })
})

onBeforeUnmount(() => {
  stop?.()
  timers.forEach(clearTimeout)
})
</script>

<template>
  <div :class="['pointer-events-none absolute inset-0 z-10 overflow-hidden']" aria-hidden="true">
    <TransitionGroup name="dahlia-slap">
      <img
        v-for="slap in slaps"
        :key="slap.key"
        :src="stickers.artwork[slap.stickerId]"
        alt=""
        :class="['dahlia-slap absolute size-28 object-contain', 'drop-shadow-lg']"
        :style="{ 'left': `${slap.left}%`, 'top': `${slap.top}%`, '--dahlia-slap-turn': `${slap.turn}deg` }"
      >
    </TransitionGroup>
  </div>
</template>

<style scoped>
.dahlia-slap {
  transform: translate(-50%, -50%) rotate(var(--dahlia-slap-turn, 0deg));
}

.dahlia-slap-enter-active {
  animation: dahlia-slap-in 0.35s cubic-bezier(0.2, 1.4, 0.4, 1);
}

.dahlia-slap-leave-active {
  transition:
    opacity 0.5s ease,
    transform 0.5s ease;
}

.dahlia-slap-leave-to {
  opacity: 0;
  transform: translate(-50%, -30%) rotate(calc(var(--dahlia-slap-turn, 0deg) + 12deg));
}

@keyframes dahlia-slap-in {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) rotate(var(--dahlia-slap-turn, 0deg)) scale(1.9);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) rotate(var(--dahlia-slap-turn, 0deg)) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dahlia-slap-enter-active {
    animation: none;
  }
}
</style>
