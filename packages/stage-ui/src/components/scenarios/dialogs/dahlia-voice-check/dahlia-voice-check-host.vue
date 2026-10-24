<script setup lang="ts">
// Dahlia: opens the voice check whenever this device needs a session: when the app starts, and when the
// 6 hours run out while it is open. "Later" waits 10 minutes. This file is Dahlia's (AIRI has no such file).
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { ref, watch } from 'vue'

import DahliaVoiceCheckDialog from './dahlia-voice-check-dialog.vue'

import { useDahliaAuth } from '../../../../stores/dahlia-auth'

const LATER_MS = 10 * 60_000

const { key, needsVoiceCheck, refresh } = useDahliaAuth()
const visibility = useDocumentVisibility()
const open = ref(false)
let laterUntil = 0

async function check() {
  if (open.value || !needsVoiceCheck.value || visibility.value !== 'visible' || Date.now() < laterUntil)
    return
  // Only a key the server knows: a wrong key is the Dahlia settings' business.
  if (!await refresh())
    return
  if (needsVoiceCheck.value)
    open.value = true
}

watch([needsVoiceCheck, visibility, key], () => void check(), { immediate: true })
useIntervalFn(() => void check(), 60_000)

watch(open, (value) => {
  if (!value && needsVoiceCheck.value)
    laterUntil = Date.now() + LATER_MS
})

// Another window of the app passed the check.
watch(needsVoiceCheck, (value) => {
  if (!value)
    open.value = false
})
</script>

<template>
  <DahliaVoiceCheckDialog v-model="open" />
</template>
