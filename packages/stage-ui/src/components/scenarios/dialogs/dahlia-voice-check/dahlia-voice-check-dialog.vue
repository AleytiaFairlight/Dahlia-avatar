<script setup lang="ts">
// Dahlia: the voice check. Dahlia's server gives a sentence and digits; the user reads them aloud and the server
// checks the voice (against their voice print), the digits and most of the sentence. The first time, and once for a
// voice print from digits alone, four sentences record the voice print; the same recordings make this device's own
// voiceprint (the Hearing module's), so a person binds their voice once. Opened by mount.ts while the apps are
// locked (mandatory: nothing closes it but a passed check), and from Settings > Dahlia. This file is Dahlia's (AIRI
// has no such file).
import type { DahliaRecorded, DahliaRecording } from '../../../../libs/dahlia-voice-recorder'
import type { DahliaChallenge } from '../../../../stores/dahlia-auth'

import { errorMessageFrom } from '@moeru/std'
import { Button } from '@proj-airi/ui'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { startDahliaRecording } from '../../../../libs/dahlia-voice-recorder'
import { holdCaptureLease } from '../../../../libs/voice/capture-lease'
import { saveDahliaLocalVoiceprint } from '../../../../libs/voice/dahlia-local-voiceprint'
import { fetchDahliaMe, requestDahliaChallenge, saveDahliaKey, sendDahliaVoice, useDahliaAuth } from '../../../../stores/dahlia-auth'
import { useVoiceprintStore } from '../../../../stores/voiceprint'

const props = withDefaults(defineProps<{
  /** Record the voice print again, in a session. */
  reenroll?: boolean
  /** The apps are locked until the check passes: no way to close it. */
  mandatory?: boolean
}>(), { reenroll: false, mandatory: false })

const emit = defineEmits<{ (e: 'done'): void }>()
const open = defineModel<boolean>({ default: false })

const MAX_SECONDS = 15
/** Sentences read on a device without a voiceprint of its own, after its check (whose recording counts too). */
const DEVICE_SENTENCES = 2
const RETRY_MS = 15_000

type Step = 'key' | 'connecting' | 'unreachable' | 'verify' | 'enroll' | 'device' | 'saving' | 'done'

const auth = useDahliaAuth()
const voiceprints = useVoiceprintStore()
const step = ref<Step>('connecting')
const keyInput = ref('')
const challenge = ref<DahliaChallenge>()
const recording = ref<DahliaRecording>()
const level = ref(0)
const busy = ref(false)
const message = ref<{ ok: boolean, text: string }>()
const samples = ref(0)
const deviceRead = ref(0)
/** A voice print from digits alone being recorded again with sentences. */
const upgrading = ref(false)
/** This dialog's recordings, for this device's voiceprint. They are dropped when it closes. */
let recordings: DahliaRecorded[] = []
let saving: AbortController | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined

const needed = computed(() => auth.me.value?.enrollNeeded ?? 4)
const reading = computed(() => step.value === 'verify' || step.value === 'enroll' || step.value === 'device')
const title = computed(() => {
  switch (step.value) {
    case 'key':
    case 'connecting':
    case 'unreachable':
      return 'Connect to Dahlia'
    case 'enroll':
      return upgrading.value || props.reenroll ? 'Record your voice print again' : 'Record your voice print'
    case 'device':
    case 'saving':
      return 'Your voice on this device'
    default:
      return 'Voice check'
  }
})
const description = computed(() => {
  const left = DEVICE_SENTENCES - deviceRead.value
  switch (step.value) {
    case 'key':
      return 'Enter the key Dahlia gave you. The app stays locked until your key and your voice are checked.'
    case 'connecting':
      return 'Connecting to Dahlia\'s server…'
    case 'unreachable':
      return 'Dahlia\'s server isn\'t reachable right now. The app stays locked until it is; it tries again every 15 seconds.'
    case 'enroll':
      return upgrading.value
        ? `Dahlia now knows voices by sentences, which hold much more of your voice than numbers. Read ${needed.value} sentences once, each with the numbers after it, alone and close to the microphone.`
        : `Dahlia knows you by your voice: read ${needed.value} sentences aloud, each with the numbers after it, alone and close to the microphone. Every 6 hours she checks it again with a new sentence.`
    case 'device':
      return `So Dahlia knows your voice on this device too, read ${left === 1 ? 'one more sentence' : `${left} more sentences`}.`
    case 'saving':
      return 'Saving your voice print on this device…'
    case 'done':
      return ''
    default:
      return `Dahlia checks your voice every 6 hours${auth.me.value ? `, ${auth.me.value.name}` : ''}. Read the sentence, then the numbers.`
  }
})

async function nextChallenge() {
  challenge.value = undefined
  try {
    challenge.value = await requestDahliaChallenge()
  }
  catch (error) {
    message.value = { ok: false, text: errorMessageFrom(error) ?? 'Dahlia\'s server isn\'t reachable right now.' }
  }
}

function stopRetry() {
  clearTimeout(retryTimer)
  retryTimer = undefined
}

/** Asks the server who the key is, and goes on to the step this device needs. */
async function connect() {
  stopRetry()
  if (!auth.key.value) {
    step.value = 'key'
    return
  }

  step.value = 'connecting'
  const me = await fetchDahliaMe()
  if (!open.value)
    return
  if (!me) {
    if (auth.keyStatus.value === 'rejected') {
      step.value = 'key'
      message.value = { ok: false, text: 'Dahlia\'s server didn\'t accept this key. Check it with Dahlia\'s owner.' }
    }
    else {
      step.value = 'unreachable'
      retryTimer = setTimeout(() => void connect(), RETRY_MS)
    }
    return
  }

  message.value = undefined
  if (props.reenroll && auth.session.value)
    await beginEnroll(false)
  else if (!me.voicePrint)
    await beginEnroll(false, me.enrollSamples)
  else if (!auth.session.value)
    await begin('verify')
  else if (auth.needsSentenceVoicePrint.value)
    await beginEnroll(true)
  else
    complete('That\'s you.')
}

async function begin(next: Step) {
  step.value = next
  await nextChallenge()
}

async function beginEnroll(upgrade: boolean, already = 0) {
  upgrading.value = upgrade
  samples.value = already
  recordings = []
  await begin('enroll')
}

async function saveKey() {
  const value = keyInput.value.trim()
  if (!value)
    return
  busy.value = true
  message.value = undefined
  try {
    await saveDahliaKey(value)
    keyInput.value = ''
    await connect()
  }
  catch (error) {
    message.value = { ok: false, text: errorMessageFrom(error) ?? 'The key couldn\'t be saved.' }
  }
  finally {
    busy.value = false
  }
}

// While the check is open, voice input pauses in every window (a capture lease, as for the voiceprint
// enrollment): what is read is never transcribed, sent to Dahlia or kept in a chat.
let lease: AbortController | undefined

function releaseLease() {
  lease?.abort()
  lease = undefined
}

watch(open, async (value) => {
  if (!value) {
    recording.value?.cancel()
    recording.value = undefined
    saving?.abort()
    stopRetry()
    recordings = []
    releaseLease()
    return
  }
  if (!lease) {
    lease = new AbortController()
    holdCaptureLease(lease.signal)
  }
  message.value = undefined
  deviceRead.value = 0
  recordings = []
  await connect()
}, { immediate: true })

// A key saved elsewhere meanwhile (the first-run setup, another window): go on with it.
watch(() => auth.key.value, (value) => {
  if (value && open.value && step.value === 'key' && !busy.value)
    void connect()
})

// Another window passed the check while this one waited: nothing is left to do here.
watch(() => auth.locked.value, (locked) => {
  if (!locked && props.mandatory && open.value && !recording.value && !busy.value
    && (step.value === 'verify' || step.value === 'key' || step.value === 'connecting' || step.value === 'unreachable')) {
    complete('Done in another window.')
  }
})

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
    const recorded = await active.stop()
    if (step.value === 'device') {
      // Only for this device's voiceprint: the server already checked this person.
      recordings.push(recorded)
      deviceRead.value++
      if (deviceRead.value >= DEVICE_SENTENCES)
        await saveOnDevice('That\'s you.')
      else
        await nextChallenge()
      return
    }

    const kind = step.value === 'enroll' ? 'enroll' : 'verify'
    const result = await sendDahliaVoice(kind, challenge.value, recorded.wav)
    if (!result.ok) {
      message.value = { ok: false, text: result.message }
      if (result.code === 'voice_mismatch' && kind === 'enroll') {
        samples.value = 0
        recordings = []
      }
      await nextChallenge()
      return
    }

    recordings.push(recorded)
    if (kind === 'enroll' && !result.done) {
      samples.value = result.samples ?? samples.value + 1
      message.value = { ok: true, text: `Got it (${samples.value} of ${result.needed ?? needed.value}). Now this one.` }
      await nextChallenge()
      return
    }

    if (kind === 'enroll') {
      await saveOnDevice('Your voice print is saved.')
      return
    }

    // The check passed. A voice print from digits alone is recorded again with sentences, once.
    if (auth.needsSentenceVoicePrint.value) {
      message.value = { ok: true, text: 'That\'s you. Now record your voice print with sentences, once.' }
      await beginEnroll(true)
      return
    }
    if (!voiceprints.voiceprint) {
      message.value = { ok: true, text: 'That\'s you.' }
      await begin('device')
      return
    }
    complete('That\'s you.')
  }
  catch (error) {
    message.value = { ok: false, text: errorMessageFrom(error) ?? 'Dahlia\'s server isn\'t reachable right now.' }
    await nextChallenge()
  }
  finally {
    busy.value = false
  }
}

/** Makes this device's voiceprint from the recordings; a failure here doesn't undo the passed check. */
async function saveOnDevice(done: string) {
  step.value = 'saving'
  challenge.value = undefined
  const current = new AbortController()
  saving = current
  let note: string | undefined
  try {
    if (await saveDahliaLocalVoiceprint(recordings, current.signal) === 'too-short')
      note = 'There was too little speech for this device\'s voiceprint; it is recorded at your next voice check.'
  }
  catch (error) {
    if (current.signal.aborted)
      return
    note = `This device couldn't keep your voiceprint (${errorMessageFrom(error) ?? 'the voice model failed'}); it is recorded at your next voice check.`
  }
  finally {
    recordings = []
    saving = undefined
  }
  complete(done, note)
}

function complete(text: string, note?: string) {
  stopRetry()
  step.value = 'done'
  challenge.value = undefined
  message.value = { ok: true, text: note ? `${text} ${note}` : text }
  emit('done')
  setTimeout(() => open.value = false, note ? 4000 : 900)
}

function changeKey() {
  recording.value?.cancel()
  recording.value = undefined
  stopRetry()
  message.value = undefined
  step.value = 'key'
}

function blockWhileMandatory(event: Event) {
  if (props.mandatory)
    event.preventDefault()
}

onBeforeUnmount(() => {
  recording.value?.cancel()
  saving?.abort()
  stopRetry()
  releaseLease()
})
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-[9998] backdrop-blur-sm', mandatory ? 'bg-black/80' : 'bg-black/50']" />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-[9999] max-h-[90dvh] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
          'flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900',
        ]"
        @escape-key-down="blockWhileMandatory"
        @pointer-down-outside="blockWhileMandatory"
        @interact-outside="blockWhileMandatory"
      >
        <DialogTitle :class="['text-lg font-semibold']">
          {{ title }}
        </DialogTitle>
        <DialogDescription v-if="description" :class="['text-sm text-neutral-600 dark:text-neutral-300']">
          {{ description }}
        </DialogDescription>

        <form v-if="step === 'key'" :class="['flex flex-col gap-2']" @submit.prevent="saveKey">
          <input
            v-model="keyInput"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="Dahlia key"
            aria-label="Dahlia key"
            :class="[
              'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none',
              'focus:border-primary-500 dark:border-neutral-700 dark:bg-neutral-800',
            ]"
          >
        </form>

        <p v-if="step === 'enroll'" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ samples }} of {{ needed }} recorded
        </p>

        <div
          v-if="reading"
          :class="['flex min-h-24 flex-col items-center justify-center gap-3 rounded-xl bg-neutral-100 px-4 py-4 text-center dark:bg-neutral-800']"
        >
          <template v-if="challenge">
            <p v-if="challenge.sentence" :class="['text-lg leading-snug']">
              {{ challenge.sentence }}
            </p>
            <span
              v-if="step !== 'device' || !challenge.sentence"
              :class="['font-mono text-2xl tracking-[0.3em]']"
              :aria-label="challenge.text"
            >
              {{ challenge.digits }}
            </span>
          </template>
          <span v-else :class="['text-sm text-neutral-500']">Getting a sentence…</span>
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

        <div :class="['flex flex-wrap items-center justify-end gap-2']">
          <Button
            v-if="mandatory && step !== 'key' && step !== 'saving' && step !== 'done' && !recording"
            label="Use another key"
            :disabled="busy"
            @click="changeKey"
          />
          <Button v-if="!mandatory && step !== 'done'" label="Cancel" :disabled="busy" @click="open = false" />
          <Button
            v-if="step === 'key'"
            variant="primary"
            icon="i-solar:key-minimalistic-2-bold-duotone"
            :label="busy ? 'Checking…' : 'Connect'"
            :loading="busy"
            :disabled="busy || !keyInput.trim()"
            @click="saveKey"
          />
          <Button
            v-else-if="step === 'unreachable'"
            variant="primary"
            label="Try again"
            @click="connect"
          />
          <template v-else-if="reading">
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
          </template>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
