<script setup lang="ts">
// Dahlia: keeps the app locked until the voice check passes. While there is no key, no session (the app starts, or
// the 6 hours run out) or only a voice print from digits, nothing but the check can be used: no settings, menus or
// chat. With `auto` (the main window, the phone) the check opens by itself and can't be put off; elsewhere (the
// desktop app's other windows) a lock screen covers the window, with a button that opens the check there. The first-run
// setup (onboarding) goes first while it shows: it asks for the key, and it is modal too. This file is Dahlia's (AIRI
// has no such file).
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import DahliaVoiceCheckDialog from './dahlia-voice-check-dialog.vue'

import { useDahliaAuth } from '../../../../stores/dahlia-auth'
import { useOnboardingStore } from '../../../../stores/onboarding'

const props = withDefaults(defineProps<{ auto?: boolean }>(), { auto: true })

const { key, locked, refresh } = useDahliaAuth()
const { showingSetup } = storeToRefs(useOnboardingStore())
const open = ref(false)
// Two modal dialogs at once hide each other from screen readers and fight over the keyboard focus.
const waiting = computed(() => props.auto && showingSetup.value)

watch([locked, waiting], ([isLocked, isWaiting]) => {
  if (isWaiting)
    open.value = false
  else if (isLocked && props.auto)
    open.value = true
}, { immediate: true })

// Who the key belongs to, asked when the app starts and when the key changes, also while a session lasts: the chats
// sync under that person (stores/dahlia-chat-sync.ts), and it says whether the voice print is from sentences yet.
watch(key, value => value && void refresh(), { immediate: true })
</script>

<template>
  <DahliaVoiceCheckDialog v-model="open" mandatory />
  <div
    v-if="locked && !open && !waiting"
    :class="['fixed inset-0 z-[9997] flex items-center justify-center bg-neutral-950/95 p-6 text-center backdrop-blur']"
  >
    <div :class="['flex max-w-sm flex-col items-center gap-3 text-neutral-100']">
      <div :class="['i-solar:lock-keyhole-minimalistic-bold-duotone text-4xl']" />
      <p :class="['text-lg font-semibold']">
        Dahlia is locked
      </p>
      <p :class="['text-sm text-neutral-300']">
        Pass the voice check to use her settings, menus and chat. It is open in Dahlia's main window, or you can do it here.
      </p>
      <Button variant="primary" icon="i-solar:microphone-3-bold-duotone" label="Voice check" @click="open = true" />
    </div>
  </div>
</template>
