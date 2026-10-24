<script setup lang="ts">
// Dahlia: the voice check. Dahlia's server shows digits; the user reads them aloud and the server checks
// both the voice (against their voice print) and the digits. The first time, three readings record the
// voice print. This file is Dahlia's (AIRI has no such file); mount.ts opens it when a session is needed.
import type { DahliaRecording } from '../../../../libs/dahlia-voice-recorder'
import type { DahliaChallenge } from '../../../../stores/dahlia-auth'

import { errorMessageFrom } from '@moeru/std'
import { Button } from '@proj-airi/ui'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { startDahliaRecording } from '../../../../libs/dahlia-voice-recorder'
import { holdCaptureLease } from '../../../../libs/voice/capture-lease'
import { fetchDahliaMe, requestDahliaChallenge, sendDahliaVoice, useDahliaAuth } from '../../../../stores/dahlia-auth'

const props = withDefaults(defineProps<{
  /** Record the voice print again, in a session. */
  reenroll?: boolean
}>(), { reenroll: false })

const emit = defineEmits<{ (e: 'done'): void }>()
const open = defineModel<boolean>({ default: false })

const MAX_SECONDS = 8

const { me } = useDahliaAuth()
const challenge = ref<DahliaChallenge>()
const recording = ref<DahliaRecording>()
const level = ref(0)
const busy = ref(false)
const message = ref<{ ok: boolean, text: string }>()
const samples = ref(0)

const enrolling = computed(() => props.reenroll || !me.value?.voicePrint)
const needed = computed(() => me.value?.enrollNeeded ?? 3)
const title = computed(() => enrolling.value ? 'Record your voice print' : 'Voice check')
const description = computed(() => enrolling.value
  ? `Dahlia knows you by your voice: read ${needed.value} sets of numbers aloud, alone and close to the microphone. Every 6 hours she checks it again with new numbers.`
  : `Dahlia checks your voice every 6 hours${me.value ? `, ${me.value.name}` : ''}. Read the numbers aloud.`)

async function nextChallenge() {
  challenge.value = undefined
  try {
    challenge.value = await requestDahliaChallenge()
  }
  catch (error) {
    message.value = { ok: false, text: errorMessageFrom(error) ?? 'Dahlia\'s server isn\'t reachable right now.' }
  }
}

// While the check is open, voice input pauses in every window (a capture lease, as for AIRI's voiceprint
// enrollment): the digits are never transcribed, sent to Dahlia or kept in a chat.
let lease: AbortController | undefined

function releaseLease() {
  lease?.abort()
  lease = undefined
}

watch(open, async (value) => {
  if (!value) {
    recording.value?.cancel()
    recording.value = undefined
    releaseLease()
    return
  }
  if (!lease) {
    lease = new AbortController()
    holdCaptureLease(lease.signal)
  }
  message.value = undefined
  samples.value = props.reenroll ? 0 : me.value?.enrollSamples ?? 0
  await fetchDahliaMe()
  if (!props.reenroll)
    samples.value = me.value?.enrollSamples ?? 0
  await nextChallenge()
}, { immediate: true })

async function record() {
  message.value = undefined
  try {
    recording.value = await startDahliaRecording({
      maxSeconds: MAX_SECONDS,
      onLevel: value => level.value = value,
      onAutoStop: () => void finish(),
    })
  }
  catch (error) {
    message.value = { ok: false, text: `The microphone couldn't be used: ${errorMessageFrom(error) ?? 'it was not allowed'}.` }
  }
}

async function finish() {
  const active = recording.value
  if (!active || !challenge.value)
    return
  recording.value = undefined
  level.value = 0
  busy.value = true
  try {
    const wav = await active.stop()
    const result = await sendDahliaVoice(enrolling.value ? 'enroll' : 'verify', challenge.value, wav)
    if (!result.ok) {
      message.value = { ok: false, text: result.message }
      if (result.code === 'voice_mismatch' && enrolling.value)
        samples.value = 0
      await nextChallenge()
      return
    }

    if (!result.done) {
      samples.value = result.samples ?? samples.value + 1
      message.value = { ok: true, text: `Got it (${samples.value} of ${result.needed ?? needed.value}). Now these numbers.` }
      await nextChallenge()
      return
    }

    message.value = { ok: true, text: enrolling.value ? 'Your voice print is saved.' : 'That\'s you.' }
    emit('done')
    setTimeout(() => open.value = false, 900)
  }
  catch (error) {
    message.value = { ok: false, text: errorMessageFrom(error) ?? 'Dahlia\'s server isn\'t reachable right now.' }
    await nextChallenge()
  }
  finally {
    busy.value = false
  }
}

onBeforeUnmount(() => {
  recording.value?.cancel()
  releaseLease()
})
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm']" />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-[9999] max-h-[90dvh] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
          'flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900',
        ]"
      >
        <DialogTitle :class="['text-lg font-semibold']">
          {{ title }}
        </DialogTitle>
        <DialogDescription :class="['text-sm text-neutral-600 dark:text-neutral-300']">
          {{ description }}
        </DialogDescription>

        <p v-if="enrolling" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ samples }} of {{ needed }} recorded
        </p>

        <div :class="['flex min-h-20 items-center justify-center rounded-xl bg-neutral-100 px-3 py-4 dark:bg-neutral-800']">
          <span v-if="challenge" :class="['font-mono text-3xl tracking-[0.3em]']" :aria-label="challenge.text">
            {{ challenge.digits }}
          </span>
          <span v-else :class="['text-sm text-neutral-500']">Getting numbers…</span>
        </div>

        <div v-if="recording" :class="['h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700']" aria-hidden="true">
          <div :class="['h-full bg-primary-500 transition-[width] duration-100']" :style="{ width: `${Math.min(100, level * 140)}%` }" />
        </div>

        <p
          v-if="message"
          role="status"
          :class="['text-sm', message.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']"
        >
          {{ message.text }}
        </p>

        <div :class="['flex flex-wrap justify-end gap-2']">
          <Button label="Later" :disabled="busy" @click="open = false" />
          <Button
            v-if="!recording"
            variant="primary"
            icon="i-solar:microphone-3-bold-duotone"
            :label="busy ? 'Checking…' : 'Record'"
            :loading="busy"
            :disabled="busy || !challenge"
            @click="record"
          />
          <Button
            v-else
            variant="primary"
            icon="i-solar:stop-bold-duotone"
            label="Done"
            @click="finish"
          />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
