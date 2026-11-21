<script setup lang="ts">
// Dahlia: the one AI setting the apps have, the Dahlia key. The apps chat and speak only through
// Dahlia's server, so there is no provider or model to choose. This page is Dahlia's (AIRI has no
// such page); scripts/apply_avatar_branding.sh points the chat's "configure" links here and hides
// AIRI's provider and model choosers. On a phone it also has her phone features (the assistant app and
// listening in the background); on a PC, whether her other devices may use it. In both apps it has the
// voice check (the second factor of the key). Her memories, the owner's people with their keys and her game
// have modules of their own: Settings > Modules > Long-Term Memory, Keys and Dark War: Survival.
import type { DahliaAnimationEntry } from '@proj-airi/stage-ui-three/dahlia-animations'
import type { DahliaPhoneStatus } from '@proj-airi/stage-ui/libs/dahlia-phone'
import type { DahliaProactiveSettings } from '@proj-airi/stage-ui/libs/dahlia-proactive'
import type { DahliaSshSettings, DahliaSshSettingsRequest } from '@proj-airi/stage-ui/libs/dahlia-ssh'
import type { DahliaVoiceEffect } from '@proj-airi/stage-ui/libs/dahlia-voice-effects'

import { errorMessageFrom } from '@moeru/std'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { addDahliaAnimation, DAHLIA_ANIMATION_IDLE_KEY, DAHLIA_ANIMATION_IDLE_NAMES_KEY, dahliaIdleAnimationNames, listDahliaAnimations, removeDahliaAnimation, sendDahliaAnimationCommand } from '@proj-airi/stage-ui-three/dahlia-animations'
import { DAHLIA_AURAS_KEY } from '@proj-airi/stage-ui-three/dahlia-auras'
import { DAHLIA_DANCE_KEY } from '@proj-airi/stage-ui-three/dahlia-dance'
import { DAHLIA_SPEECH_BUBBLE_KEY } from '@proj-airi/stage-ui-three/dahlia-speech-bubble'
import { DahliaVoiceCheckDialog } from '@proj-airi/stage-ui/components/scenarios/dialogs/dahlia-voice-check/mount'
import { DAHLIA_ASSISTANT_REACTIONS_KEY } from '@proj-airi/stage-ui/libs/dahlia-assistant-reactions'
import { DAHLIA_AUTO_EXPRESSIONS_KEY } from '@proj-airi/stage-ui/libs/dahlia-auto-expressions'
import { DAHLIA_CHAT_BUBBLES_KEY } from '@proj-airi/stage-ui/libs/dahlia-chat-bubbles'
import { DAHLIA_FLOAT_PICTURES_KEY } from '@proj-airi/stage-ui/libs/dahlia-chat-edits'
import { DAHLIA_DEVICE_NAME_KEY, dahliaSystemName } from '@proj-airi/stage-ui/libs/dahlia-device-name'
import { DAHLIA_MEMORY_CHIPS_KEY } from '@proj-airi/stage-ui/libs/dahlia-memory-chips'
import { DAHLIA_MOOD_BUBBLES_KEY } from '@proj-airi/stage-ui/libs/dahlia-mood-bubbles'
import { useDahliaPhoneControls } from '@proj-airi/stage-ui/libs/dahlia-phone'
import { DAHLIA_PROACTIVE_KEY, readDahliaProactiveSettings } from '@proj-airi/stage-ui/libs/dahlia-proactive'
import { DAHLIA_REPLY_SUGGESTIONS_KEY } from '@proj-airi/stage-ui/libs/dahlia-reply-suggestions'
import { DAHLIA_SPOKEN_HIGHLIGHT_KEY } from '@proj-airi/stage-ui/libs/dahlia-spoken-highlight'
import { dahliaSshSettings, hasDahliaSsh } from '@proj-airi/stage-ui/libs/dahlia-ssh'
import { DAHLIA_DESKTOP_STICKERS_KEY } from '@proj-airi/stage-ui/libs/dahlia-sticker-slap'
import { DAHLIA_THINKING_FILLERS_KEY } from '@proj-airi/stage-ui/libs/dahlia-thinking-fillers'
import { DAHLIA_VOICE_EFFECT_KEY, DAHLIA_VOICE_EFFECTS, readDahliaVoiceEffect } from '@proj-airi/stage-ui/libs/dahlia-voice-effects'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { signOutDahlia, useDahliaAuth } from '@proj-airi/stage-ui/stores/dahlia-auth'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Button, FieldCheckbox, FieldInput } from '@proj-airi/ui'
import { useDocumentVisibility, useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'

const DAHLIA_PROVIDER_ID = 'dahlia'

const providerConfigStore = useProviderConfigStore()
const providerStore = useProviderStore()
// Who the key belongs to: the owner, or someone she made a key for.
const auth = useDahliaAuth()

const savedKey = computed(() => {
  const apiKey = providerConfigStore.getProviderConfig(DAHLIA_PROVIDER_ID)?.apiKey
  return typeof apiKey === 'string' ? apiKey : ''
})
const key = ref(savedKey.value)
const busy = ref(false)
const status = ref<{ ok: boolean, message: string }>()

async function check(apiKey: string) {
  try {
    const response = await fetch(`${SERVER_URL}/api/v1/openai/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (response.ok)
      return { ok: true, message: 'Connected. Dahlia\'s server accepts this key.' }
    if (response.status === 401)
      return { ok: false, message: 'Dahlia\'s server didn\'t accept this key.' }
    return { ok: false, message: `Dahlia's server answered ${response.status}. Try again later.` }
  }
  catch {
    return { ok: false, message: 'Dahlia\'s server isn\'t reachable right now.' }
  }
}

async function save() {
  const apiKey = key.value.trim()
  if (!apiKey)
    return
  busy.value = true
  try {
    await providerStore.initializeProvider(DAHLIA_PROVIDER_ID)
    await providerConfigStore.patchProviderConfig(DAHLIA_PROVIDER_ID, { apiKey })
    await providerStore.forceProviderConfigured(DAHLIA_PROVIDER_ID)
    status.value = await check(apiKey)
  }
  finally {
    busy.value = false
  }
}

// The phone's features, when the app runs on Android.
const phone = useDahliaPhoneControls()
const phoneStatus = ref<DahliaPhoneStatus>()
const phoneError = ref<string>()

async function refreshPhone() {
  if (phone.value)
    phoneStatus.value = await phone.value.status().catch(() => undefined)
}

async function setBackgroundListening(enabled: boolean) {
  phoneError.value = undefined
  try {
    phoneStatus.value = await phone.value!.setBackgroundListening(enabled)
  }
  catch (error) {
    phoneError.value = errorMessageFrom(error) ?? 'Android didn\'t allow it.'
    await refreshPhone()
  }
}

// Android's settings pages are another app; the status may have changed when the app comes back.
const visibility = useDocumentVisibility()
watch(visibility, value => value === 'visible' && void refreshPhone())
onMounted(() => void refreshPhone())

// On a PC: the desktop app's main window offers its tools (src/renderer/dahlia-remote-tools.ts); this
// window reads and changes the same settings.
const isDesktop = isStageTamagotchi()
const remoteToolsEnabled = useLocalStorage('dahlia/remote-tools-enabled', true)
// The stage reads this before each spoken answer (libs/dahlia-thinking-fillers.ts).
const thinkingFillers = useLocalStorage(DAHLIA_THINKING_FILLERS_KEY, true)
// The 3D scene reads this before each aura (stage-ui-three components/dahlia-auras.ts).
const avatarAuras = useLocalStorage(DAHLIA_AURAS_KEY, true)
const assistantReactions = useLocalStorage(DAHLIA_ASSISTANT_REACTIONS_KEY, true)
const spokenHighlight = useLocalStorage(DAHLIA_SPOKEN_HIGHLIGHT_KEY, true)
const moodBubbles = useLocalStorage(DAHLIA_MOOD_BUBBLES_KEY, true)
const autoExpressions = useLocalStorage(DAHLIA_AUTO_EXPRESSIONS_KEY, true)
const memoryChips = useLocalStorage(DAHLIA_MEMORY_CHIPS_KEY, true)
const speechBubble = useLocalStorage(DAHLIA_SPEECH_BUBBLE_KEY, true)
const floatPictures = useLocalStorage(DAHLIA_FLOAT_PICTURES_KEY, true)
const chatBubbles = useLocalStorage(DAHLIA_CHAT_BUBBLES_KEY, true)
const desktopStickers = useLocalStorage(DAHLIA_DESKTOP_STICKERS_KEY, true)
const replySuggestions = useLocalStorage(DAHLIA_REPLY_SUGGESTIONS_KEY, false)
// The stage listens for this key (libs/dahlia-voice-effects.ts); written as plain text, as it reads it.
const voiceEffect = useLocalStorage<DahliaVoiceEffect>(DAHLIA_VOICE_EFFECT_KEY, 'none', { serializer: { read: readDahliaVoiceEffect, write: value => value } })
// Speaking first (libs/dahlia-proactive.ts): the desktop app's main window reads this every minute.
const speakFirst = ref<DahliaProactiveSettings>(readDahliaProactiveSettings(localStorage.getItem(DAHLIA_PROACTIVE_KEY)))
function setSpeakFirst(patch: Partial<DahliaProactiveSettings>) {
  speakFirst.value = readDahliaProactiveSettings(JSON.stringify({ ...speakFirst.value, ...patch }))
  localStorage.setItem(DAHLIA_PROACTIVE_KEY, JSON.stringify(speakFirst.value))
}

// Her animation library (stage-ui-three components/dahlia-animations.ts): the avatar's window plays them.
const idleAnimations = useLocalStorage(DAHLIA_ANIMATION_IDLE_KEY, true)
const danceToMusic = useLocalStorage(DAHLIA_DANCE_KEY, true)
const animations = ref<DahliaAnimationEntry[]>([])
const animationInput = ref<HTMLInputElement>()
const animationMessage = ref('')
const idleAnimationNames = ref<string[]>([])

function setIdleAnimation(name: string, idle: boolean) {
  idleAnimationNames.value = idle ? [...idleAnimationNames.value, name] : idleAnimationNames.value.filter(other => other !== name)
  localStorage.setItem(DAHLIA_ANIMATION_IDLE_NAMES_KEY, JSON.stringify(idleAnimationNames.value))
}

async function loadAnimations() {
  try {
    animations.value = await listDahliaAnimations()
    idleAnimationNames.value = dahliaIdleAnimationNames(animations.value.map(animation => animation.name))
  }
  catch (error) {
    animationMessage.value = errorMessageFrom(error) ?? String(error)
  }
}

async function addAnimations(event: Event) {
  const input = event.target as HTMLInputElement
  const problems: string[] = []
  let added = 0
  for (const file of Array.from(input.files ?? [])) {
    try {
      await addDahliaAnimation(file)
      added++
    }
    catch (error) {
      problems.push(errorMessageFrom(error) ?? String(error))
    }
  }
  input.value = ''
  animationMessage.value = [added > 0 ? `Added ${added}.` : '', ...problems].filter(Boolean).join(' ')
  await loadAnimations()
}

async function removeAnimation(name: string) {
  await removeDahliaAnimation(name)
  animationMessage.value = `Removed ${name}.`
  await loadAnimations()
}

function playAnimation(name: string) {
  sendDahliaAnimationCommand({ op: 'play', name })
  animationMessage.value = `Playing ${name} on her 3D avatar.`
}

function stopAnimation() {
  sendDahliaAnimationCommand({ op: 'stop' })
}

onMounted(loadAnimations)
const remoteToolsUnattended = useLocalStorage('dahlia/remote-tools-unattended', false)
// The name her other devices see: empty means the system's name (the PC's host name, the phone's device name).
const deviceName = useLocalStorage(DAHLIA_DEVICE_NAME_KEY, '')
if (deviceName.value === 'Windows PC')
  deviceName.value = ''
const systemName = ref<string>()

// SSH from this PC (the desktop app's src/main/dahlia-ssh.ts): its key, the saved passwords and the trusted servers.
const sshAvailable = hasDahliaSsh()
const ssh = ref<DahliaSshSettings>()
const sshServer = ref('')
const sshUser = ref('')
const sshPassword = ref('')
const sshMessage = ref<{ ok: boolean, text: string }>()

async function sshRequest(request: DahliaSshSettingsRequest, done?: string) {
  try {
    ssh.value = await dahliaSshSettings(request)
    sshMessage.value = done ? { ok: true, text: done } : undefined
  }
  catch (error) {
    sshMessage.value = { ok: false, text: errorMessageFrom(error) ?? 'That didn\'t work.' }
  }
}

async function saveSshPassword() {
  const [, user, host, port] = /^(?:([^@]+)@)?([^:]+)(?::(\d+))?$/.exec(sshServer.value.trim()) ?? []
  if (!host || (!user && !sshUser.value.trim()) || !sshPassword.value)
    return
  await sshRequest({ op: 'save-password', host, user: user || sshUser.value.trim(), port: port ? Number(port) : undefined, password: sshPassword.value }, 'Saved. Dahlia logs in with it; she never sees it.')
  // The password leaves the page as soon as it is saved.
  sshPassword.value = ''
}

async function copySshKey() {
  if (ssh.value?.publicKey)
    await navigator.clipboard.writeText(ssh.value.publicKey)
  sshMessage.value = { ok: true, text: 'Copied this PC\'s public key.' }
}

onMounted(() => sshAvailable && void sshRequest({ op: 'list' }))
onMounted(async () => systemName.value = await dahliaSystemName())
const remoteToolsStatus = useLocalStorage<{ state: string, tools: number } | null>('dahlia/remote-tools-status', null, {
  serializer: { read: value => JSON.parse(value), write: value => JSON.stringify(value) },
})
const remoteToolsMessage = computed(() => {
  switch (remoteToolsStatus.value?.state) {
    case 'connected':
      return `Connected: Dahlia can use ${remoteToolsStatus.value.tools} tools of this PC from your other devices.`
    case 'no-key':
      return 'Save the Dahlia key first.'
    case 'bad-key':
      return 'Dahlia\'s server didn\'t accept the key.'
    case 'voice-check':
      return 'Pass the voice check on this PC once; after that it stays connected.'
    case 'error':
      return 'Dahlia\'s server isn\'t reachable right now; this PC tries again.'
    case 'off':
      return 'Off: your other devices can\'t use this PC.'
    default:
      return 'Connecting…'
  }
})

// The voice check.
const voiceCheckOpen = ref(false)
const reenroll = ref(false)
const sessionUntil = computed(() => auth.expiresAt.value ? new Date(auth.expiresAt.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined)

function openVoiceCheck(again = false) {
  reenroll.value = again
  voiceCheckOpen.value = true
}

watch(savedKey, () => void auth.refresh(), { immediate: true })

async function checkSaved() {
  busy.value = true
  try {
    status.value = await check(savedKey.value)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-6 pb-12']">
    <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      Dahlia chats and speaks through her own server at {{ SERVER_URL }}. The Dahlia key is all it needs.
    </p>

    <div :class="['flex flex-col gap-4']">
      <FieldInput
        v-model="key"
        type="password"
        label="Dahlia key"
        description="The key of your Dahlia server. Only people with the key can chat with her."
        placeholder="Dahlia key"
        autocomplete="off"
        required
      />
      <div :class="['flex flex-wrap gap-2']">
        <Button
          variant="primary"
          icon="i-solar:diskette-bold-duotone"
          label="Save"
          :loading="busy"
          :disabled="busy || !key.trim() || key.trim() === savedKey"
          @click="save"
        />
        <Button
          icon="i-solar:plug-circle-bold-duotone"
          label="Check connection"
          :disabled="busy || !savedKey"
          @click="checkSaved"
        />
      </div>
    </div>

    <p
      v-if="status"
      role="status"
      :class="['text-sm', status.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']"
    >
      {{ status.message }}
    </p>

    <section v-if="savedKey && auth.me.value" :class="['flex flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        You
      </h2>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        This key is {{ auth.me.value.name }}'s{{ auth.me.value.owner ? ', Dahlia\'s owner' : '' }}. Dahlia checks your voice every 6 hours on each device, with a sentence you read aloud, and the app stays locked until it passes, so nobody else can use your key: your chats, memories and settings are yours.
      </p>
      <p role="status" :class="['text-sm', auth.session.value ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400']">
        {{ auth.session.value
          ? `Voice check passed: this device is signed in until ${sessionUntil}.`
          : auth.me.value.voicePrint ? 'This device needs a voice check.' : 'Record your voice print to start chatting.' }}
      </p>
      <div :class="['flex flex-wrap gap-2']">
        <Button
          v-if="!auth.session.value"
          variant="primary"
          icon="i-solar:microphone-3-bold-duotone"
          :label="auth.me.value.voicePrint ? 'Voice check' : 'Record voice print'"
          @click="openVoiceCheck()"
        />
        <template v-else>
          <Button icon="i-solar:microphone-3-bold-duotone" label="Record voice print again" @click="openVoiceCheck(true)" />
          <Button icon="i-solar:logout-2-bold-duotone" label="Sign out on this device" @click="signOutDahlia()" />
        </template>
      </div>
      <DahliaVoiceCheckDialog v-model="voiceCheckOpen" :reenroll="reenroll" />
    </section>

    <section v-if="phone && phoneStatus" :class="['flex flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        On this phone
      </h2>

      <div :class="['flex flex-col gap-2']">
        <p :class="['font-medium']">
          Dahlia as your phone's assistant
        </p>
        <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ phoneStatus.assistant
            ? 'Dahlia is your assistant: hold the power button, or swipe up from a bottom corner, and she listens.'
            : 'Choose Dahlia as the "Digital assistant app" in Android\'s settings. Then holding the power button, or swiping up from a bottom corner, opens her listening.' }}
        </p>
        <div>
          <Button icon="i-solar:settings-bold-duotone" label="Open assistant settings" @click="phone.openAssistantSettings()" />
        </div>
      </div>

      <FieldInput
        v-model="deviceName"
        label="This phone's name"
        description="How Dahlia calls this phone on your other devices. Empty: the phone's own name from Android's settings."
        :placeholder="systemName ?? 'Phone'"
      />

      <div :class="['flex flex-col gap-2']">
        <FieldCheckbox
          :model-value="phoneStatus.backgroundListening"
          label="Listen for &quot;Dahlia&quot; in the background"
          description="Hears her name while the app is closed or the screen is off, and opens her listening. Android shows a notification while she listens, and it uses some battery. Only her name is listened for; nothing is recorded or sent until she opens."
          @update:model-value="setBackgroundListening"
        />
        <p v-if="phoneError" role="status" :class="['text-sm text-red-600 dark:text-red-400']">
          {{ phoneError }}
        </p>
        <template v-if="phoneStatus.backgroundListening">
          <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
            {{ phoneStatus.overlay
              ? 'When she hears her name, Dahlia comes to the front by herself.'
              : 'Allow Dahlia to display over other apps, so she comes to the front when she hears her name. Without it, a notification opens her.' }}
          </p>
          <div :class="['flex flex-wrap gap-2']">
            <Button v-if="!phoneStatus.overlay" icon="i-solar:widget-add-bold-duotone" label="Allow display over other apps" @click="phone.openOverlaySettings()" />
            <Button icon="i-solar:battery-charge-bold-duotone" label="Battery settings" @click="phone.openBatterySettings()" />
          </div>
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            If she stops hearing you after a while, set the app's battery use to "Unrestricted".
          </p>
        </template>
      </div>
    </section>

    <section :class="['flex flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        Her voice and avatar
      </h2>
      <FieldCheckbox
        v-model="thinkingFillers"
        label="Say a short phrase while an answer is slow to start"
        description="When a spoken answer hasn't started after a few seconds, she says something like &quot;Hmm, let me think.&quot;, and once more if it takes much longer. Answers that start quickly get none."
      />
      <FieldCheckbox
        :model-value="speakFirst.enabled"
        label="Let her say something first"
        description="At a quiet moment on your PC she may say something on her own: about what you are doing, something she remembers, or a kind word. She decides whether anything is worth saying, and mostly stays quiet. Never while you are away or the two of you are talking."
        @update:model-value="setSpeakFirst({ enabled: $event === true })"
      />
      <div v-if="speakFirst.enabled" :class="['grid grid-cols-2 gap-3', 'sm:grid-cols-4']">
        <FieldInput :model-value="String(speakFirst.everyMinutes)" label="At most every (minutes)" type="number" @update:model-value="setSpeakFirst({ everyMinutes: Number($event) })" />
        <FieldInput :model-value="String(speakFirst.perDay)" label="Times a day" type="number" @update:model-value="setSpeakFirst({ perDay: Number($event) })" />
        <FieldInput :model-value="String(speakFirst.fromHour)" label="From (hour)" type="number" @update:model-value="setSpeakFirst({ fromHour: Number($event) })" />
        <FieldInput :model-value="String(speakFirst.toHour)" label="Until (hour)" type="number" @update:model-value="setSpeakFirst({ toHour: Number($event) })" />
      </div>
      <div :class="['flex flex-col gap-2']">
        <span :class="['text-sm font-medium']">Voice effect</span>
        <div :class="['flex flex-wrap gap-2']">
          <Button
            v-for="effect in DAHLIA_VOICE_EFFECTS"
            :key="effect.id"
            size="sm"
            :variant="voiceEffect === effect.id ? 'primary' : 'secondary'"
            @click="voiceEffect = effect.id"
          >
            {{ effect.name }}
          </Button>
        </div>
        <span :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          How her voice sounds on this device: soft is warmer and more even, radio is narrow and a little rough, echo and hall add space. Her mouth follows the clean voice.
        </span>
      </div>
      <FieldCheckbox
        v-model="chatBubbles"
        label="Show her answers as several bubbles"
        description="An answer with several paragraphs is shown as several bubbles, one a thought. Code, lists and tables stay whole. It applies to new messages."
      />
      <FieldCheckbox
        v-if="isDesktop"
        v-model="replySuggestions"
        label="Suggest replies after her answers"
        description="After each answer, up to three short replies to tap appear above the message box; a tap fills the box, you still send it. Each answer costs her model one more request, so her next answer can start later."
      />
      <FieldCheckbox
        v-model="desktopStickers"
        label="Slap her stickers onto the stage"
        description="A sticker she sends with an answer also lands beside her avatar for a few seconds. Stickers themselves are turned on, and yours added, in Settings > Modules > Stickers."
      />
      <FieldCheckbox
        v-model="spokenHighlight"
        label="Mark what she is saying in the chat"
        description="While she speaks, the sentence she is saying is highlighted in her message."
      />
      <FieldCheckbox
        v-model="moodBubbles"
        label="Color her messages by mood"
        description="A message of hers takes the color of the first feeling she shows in it: green when happy, blue when sad, red when angry, purple when surprised, amber when thinking, pink when awkward."
      />
      <FieldCheckbox
        v-model="autoExpressions"
        label="Her face follows what she says"
        description="When her reply doesn't say how she feels, her server reads the feeling of each sentence she speaks and her avatar's face shows it as she says it. A plain sentence leaves her face as it is."
      />
      <FieldCheckbox
        v-model="memoryChips"
        label="Show what she remembered"
        description="Under a reply of hers, the memories her server had in mind for it: facts, earlier talks and things said before, each with its date. Folded to one chip until you open it."
      />
      <FieldCheckbox
        v-if="isDesktop"
        v-model="speechBubble"
        label="Speech bubble at her head"
        description="While she speaks, what she says shows in a bubble beside her 3D avatar's head, a part at a time, its edge in the color of how she feels (with a small heart, raindrop, star, spark or dots)."
      />
      <FieldCheckbox
        v-if="isDesktop"
        v-model="floatPictures"
        label="Her drawings float on the desktop"
        description="When she draws a picture in this chat, it also opens in a small window of its own on the desktop, on top until you close it; it can be saved or set as the background there. Float on the desktop in a picture's message menu opens one by hand."
      />
      <FieldCheckbox
        v-if="isDesktop"
        v-model="assistantReactions"
        label="React to my coding assistant"
        description="When a coding agent such as Claude Code works, waits for your OK, finishes or fails, her avatar shows it with an expression and a caption. It needs the hook from scripts/dahlia-assistant-hook.sh on the machine the agent runs on."
      />
      <FieldCheckbox
        v-model="avatarAuras"
        label="Show her strong emotions as an aura"
        description="With a 3D avatar: fire when she is angry, sparks when she is surprised, an arcane glow when she is curious, leaves and light when she is happy, for a few seconds and not more often than every 20 seconds."
      />

      <h3 :class="['text-base font-semibold']">
        Her animations
      </h3>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        Her 3D avatar plays one of these now and then while she idles, and she can play them herself. Tick the ones
        that may play while she idles; the dances are left out at first. You can add your own VRM animation files
        (.vrma), which stay on this device. The ones that came with the app are for personal, non-commercial use.
      </p>
      <FieldCheckbox
        v-model="idleAnimations"
        label="Play an animation now and then while she idles"
        description="About once a minute, one of the ticked animations below, chosen at random."
      />
      <FieldCheckbox
        v-model="danceToMusic"
        label="Dance to music"
        description="When Beat Sync (Settings > Modules > Beat Sync) hears a steady beat in what plays on this PC, her 3D avatar dances at the music's tempo, picking a dance that fits how lively the song is (calm, medium or intense, from its tempo and how loud its beats get), changes to another every few bars or when the song turns livelier or calmer, and stops with the music."
      />
      <ul v-if="animations.length > 0" :class="['flex flex-col gap-2']">
        <li v-for="animation in animations" :key="animation.name" :class="['flex items-center gap-2', 'text-sm']">
          <label :class="['flex flex-1 items-center gap-2', 'min-w-0']">
            <input
              type="checkbox"
              :checked="idleAnimationNames.includes(animation.name)"
              :aria-label="`Play ${animation.name} while she idles`"
              @change="setIdleAnimation(animation.name, ($event.target as HTMLInputElement).checked)"
            >
            <span :class="['truncate']">{{ animation.name }}</span>
          </label>
          <Button size="sm" variant="secondary" @click="playAnimation(animation.name)">
            Play
          </Button>
          <Button v-if="!animation.builtIn" size="sm" variant="secondary" @click="removeAnimation(animation.name)">
            Remove
          </Button>
        </li>
      </ul>
      <div :class="['flex items-center gap-2']">
        <Button size="sm" variant="primary" @click="animationInput?.click()">
          Add animations
        </Button>
        <Button v-if="animations.length > 0" size="sm" variant="secondary" @click="stopAnimation">
          Stop
        </Button>
        <input ref="animationInput" type="file" accept=".vrma" multiple :class="['hidden']" @change="addAnimations">
      </div>
      <p v-if="animationMessage" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ animationMessage }}
      </p>
    </section>

    <section v-if="isDesktop" :class="['flex flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        Your other devices
      </h2>
      <FieldCheckbox
        v-model="remoteToolsEnabled"
        label="Let Dahlia use this PC from your other devices"
        description="Ask her on your phone (or on Discord) to find a file on this PC, run a PowerShell command or do something here. Reading files needs no confirmation; anything else asks on this PC first, and an allowed action runs without asking for 10 minutes."
      />
      <FieldCheckbox
        v-model="remoteToolsUnattended"
        label="Run actions without asking on this PC"
        description="PowerShell commands and other actions from your phone run at once, without a confirmation here, so they work while you are away from the PC. Only you can ask for them: your key needs your voice."
      />
      <FieldInput
        v-model="deviceName"
        label="This PC's name"
        description="How Dahlia calls this PC on your other devices. Empty: the PC's own name."
        :placeholder="systemName ?? 'Windows PC'"
      />
      <p role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ remoteToolsMessage }}
      </p>
    </section>

    <section v-if="sshAvailable" :class="['flex flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        SSH
      </h2>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        Dahlia can run commands on your other machines over SSH from this PC. She logs in with this PC's key, or with a saved password: one you save here is kept encrypted on this PC and she never sees it; one you tell her in chat (her ssh_save_password tool, which asks here on this PC each time) passes through her server before it is encrypted here. The first connection to a server trusts its host key; if the key changes later, she refuses to connect.
      </p>

      <div :class="['flex flex-col gap-2']">
        <p :class="['text-sm font-medium']">
          This PC's key
        </p>
        <template v-if="ssh?.publicKey">
          <code :class="['break-all rounded-lg bg-neutral-100 p-2 text-xs dark:bg-neutral-800']">{{ ssh.publicKey }}</code>
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ ssh.keyFile }}. A server takes logins with it once this line is in ~/.ssh/authorized_keys there; Dahlia's ssh_install_key adds it with a saved password.
          </p>
          <div>
            <Button icon="i-solar:copy-bold-duotone" label="Copy public key" @click="copySshKey" />
          </div>
        </template>
        <div v-else>
          <Button icon="i-solar:key-minimalistic-2-bold-duotone" label="Create this PC's key" @click="sshRequest({ op: 'create-key' }, 'This PC has a key now.')" />
        </div>
      </div>

      <div :class="['flex flex-col gap-2']">
        <p :class="['text-sm font-medium']">
          Saved passwords
        </p>
        <ul v-if="ssh?.passwords.length" :class="['flex flex-col gap-1']">
          <li v-for="target in ssh.passwords" :key="target" :class="['flex items-center justify-between gap-2 text-sm']">
            <span :class="['font-mono']">{{ target }}</span>
            <Button label="Delete" @click="sshRequest({ op: 'delete-password', target }, `Deleted the password of ${target}.`)" />
          </li>
        </ul>
        <form v-if="ssh?.canSavePasswords" :class="['flex flex-col gap-2']" @submit.prevent="saveSshPassword">
          <FieldInput v-model="sshServer" label="Server" description="A host name or IP address, also as user@host or user@host:port." placeholder="pi@192.168.10.20" />
          <FieldInput v-model="sshUser" label="User" description="The user to log in as, unless the server says it." placeholder="pi" />
          <FieldInput v-model="sshPassword" type="password" label="Password" />
          <div>
            <Button variant="primary" icon="i-solar:lock-password-bold-duotone" label="Save password" :disabled="!sshServer.trim() || !sshPassword" @click="saveSshPassword" />
          </div>
        </form>
        <p v-else-if="ssh" :class="['text-sm text-amber-600 dark:text-amber-400']">
          This PC can't encrypt passwords, so none can be saved. Use this PC's key instead.
        </p>
      </div>

      <div v-if="ssh?.hosts.length" :class="['flex flex-col gap-2']">
        <p :class="['text-sm font-medium']">
          Trusted servers
        </p>
        <ul :class="['flex flex-col gap-1']">
          <li v-for="host in ssh.hosts" :key="host.host" :class="['flex items-center justify-between gap-2 text-sm']">
            <span :class="['flex flex-col']">
              <span :class="['font-mono']">{{ host.host }}</span>
              <span :class="['break-all text-xs text-neutral-500 dark:text-neutral-400']">{{ host.fingerprint }}</span>
            </span>
            <Button label="Forget key" @click="sshRequest({ op: 'forget-host', host: host.host }, `${host.host}'s key is trusted again at the next connection.`)" />
          </li>
        </ul>
      </div>

      <p v-if="sshMessage" role="status" :class="['text-sm', sshMessage.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
        {{ sshMessage.text }}
      </p>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Dahlia
  subtitleKey: settings.title
  description: Your Dahlia key
  icon: i-solar:key-minimalistic-square-2-bold-duotone
  settingsEntry: true
  order: 0
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
