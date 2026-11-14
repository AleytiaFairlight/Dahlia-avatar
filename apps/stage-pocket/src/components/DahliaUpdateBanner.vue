<script setup lang="ts">
// Dahlia: the Android app's "Install now" banner. A downloaded update otherwise waits until the app leaves the screen
// (or, where Android has to ask, for its "Update this app?" dialog); this lets the owner install it right away. The
// app closes and opens again updated. This file is Dahlia's (AIRI has no such file); App.vue shows it.
import { Button } from '@proj-airi/ui'
import { computed, ref } from 'vue'

import { installDahliaUpdateNow, dahliaUpdateStatus as status } from '../dahlia-updater'

const dismissed = ref<string>()
const shown = computed(() => !!status.available
  && dismissed.value !== status.available
  && (status.phase === 'when-hidden' || status.phase === 'confirm' || status.phase === 'asked-recently' || status.phase === 'now'))
const installing = computed(() => status.phase === 'now')
</script>

<template>
  <div
    v-if="shown"
    role="status"
    :class="[
      'fixed left-1/2 z-[200] -translate-x-1/2',
      'top-[calc(env(safe-area-inset-top)+0.75rem)]',
      'max-w-[calc(100vw-2rem)] w-max',
      'flex items-center gap-3',
      'rounded-2xl px-4 py-2 shadow-lg',
      'bg-white/95 text-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-100',
      'text-sm',
    ]"
  >
    <span>{{ installing ? `Installing Dahlia ${status.available}…` : `Dahlia ${status.available} is ready` }}</span>
    <Button
      v-if="!installing"
      size="sm"
      label="Install now"
      icon="i-solar:download-minimalistic-bold"
      @click="installDahliaUpdateNow()"
    />
    <button
      v-if="!installing"
      type="button"
      aria-label="Later"
      :class="['i-solar:close-circle-linear', 'text-lg', 'text-neutral-500']"
      @click="dismissed = status.available"
    />
  </div>
</template>
