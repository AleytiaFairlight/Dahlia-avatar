<script setup lang="ts">
// Dahlia: the one AI setting the apps have, the Dahlia key. The apps chat and speak only through
// Dahlia's server, so there is no provider or model to choose. This page is Dahlia's (AIRI has no
// such page); scripts/apply_avatar_branding.sh points the chat's "configure" links here and hides
// AIRI's provider and model choosers. On a phone it also has her phone features (the assistant app and
// listening in the background); on a PC, whether her other devices may use it and her game. In both apps
// it links to her memories (Long-Term Memory, which her server keeps for Discord and the apps alike), the voice
// check (the second factor of the key) and, for the owner, the people she made keys for.
import type { DahliaAnimationEntry } from '@proj-airi/stage-ui-three/dahlia-animations'
import type { DahliaPhoneStatus } from '@proj-airi/stage-ui/libs/dahlia-phone'
import type { DahliaProactiveSettings } from '@proj-airi/stage-ui/libs/dahlia-proactive'
import type { DahliaSshSettings, DahliaSshSettingsRequest } from '@proj-airi/stage-ui/libs/dahlia-ssh'
import type { DahliaVoiceEffect } from '@proj-airi/stage-ui/libs/dahlia-voice-effects'

import { errorMessageFrom } from '@moeru/std'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { addDahliaAnimation, DAHLIA_ANIMATION_IDLE_KEY, DAHLIA_ANIMATION_IDLE_NAMES_KEY, dahliaIdleAnimationNames, listDahliaAnimations, removeDahliaAnimation, sendDahliaAnimationCommand } from '@proj-airi/stage-ui-three/dahlia-animations'
import { DAHLIA_AURAS_KEY } from '@proj-airi/stage-ui-three/dahlia-auras'
import { DahliaVoiceCheckDialog } from '@proj-airi/stage-ui/components/scenarios/dialogs/dahlia-voice-check/mount'
import { DAHLIA_DEVICE_NAME_KEY, dahliaSystemName } from '@proj-airi/stage-ui/libs/dahlia-device-name'
import { useDahliaPhoneControls } from '@proj-airi/stage-ui/libs/dahlia-phone'
import { DAHLIA_PROACTIVE_KEY, readDahliaProactiveSettings } from '@proj-airi/stage-ui/libs/dahlia-proactive'
import { dahliaSshSettings, hasDahliaSsh } from '@proj-airi/stage-ui/libs/dahlia-ssh'
import { DAHLIA_THINKING_FILLERS_KEY } from '@proj-airi/stage-ui/libs/dahlia-thinking-fillers'
import { DAHLIA_VOICE_EFFECT_KEY, DAHLIA_VOICE_EFFECTS, readDahliaVoiceEffect } from '@proj-airi/stage-ui/libs/dahlia-voice-effects'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { dahliaHeaders, signOutDahlia, useDahliaAuth } from '@proj-airi/stage-ui/stores/dahlia-auth'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Button, FieldCheckbox, FieldInput, FieldTextArea } from '@proj-airi/ui'
import { useDocumentVisibility, useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

const DAHLIA_PROVIDER_ID = 'dahlia'

const providerConfigStore = useProviderConfigStore()
const providerStore = useProviderStore()
// Who the key belongs to: the owner, or someone she made a key for.
const auth = useDahliaAuth()
const isOwner = computed(() => auth.me.value?.owner === true)

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

// Her game on the PC: the main window plays it (src/renderer/dahlia-game-player.ts in the desktop app); this
// window sends it requests through localStorage and shows its state.
const DEFAULT_GAME_GOAL = 'Collect free rewards and resources, finish the daily quests, upgrade buildings and train troops.'
// The game's own window; "Dark War" is its launcher.
const gameWindowTitle = useLocalStorage('dahlia/game-window-title', 'DarkWar')
const gameGoal = useLocalStorage('dahlia/game-goal', DEFAULT_GAME_GOAL)
const gameMinutes = useLocalStorage('dahlia/game-minutes', '')
const gameStatus = useLocalStorage<{ running: boolean, steps: number, log: string[], ended?: string } | null>('dahlia/game-status', null, {
  serializer: { read: value => JSON.parse(value), write: value => JSON.stringify(value) },
})

// Watching Aleytia play, to learn the game (src/renderer/dahlia-game-watch.ts in the desktop app).
const watchMinutes = useLocalStorage('dahlia/game-watch-minutes', '60')
const watchStatus = useLocalStorage<{ running: boolean, samples: number, missed: number, log: string[], ended?: string } | null>('dahlia/game-watch-status', null, {
  serializer: { read: value => JSON.parse(value), write: value => JSON.stringify(value) },
})

function requestGame(action: 'start' | 'stop' | 'watch' | 'watch-stop') {
  // A new value each time, so the main window hears it as a change.
  localStorage.setItem('dahlia/game-request', JSON.stringify({
    action,
    goal: gameGoal.value,
    windowTitle: gameWindowTitle.value,
    minutes: Number(action === 'watch' ? watchMinutes.value : gameMinutes.value) || undefined,
    at: Date.now(),
  }))
}

// The voice check.
const voiceCheckOpen = ref(false)
const reenroll = ref(false)
const sessionUntil = computed(() => auth.expiresAt.value ? new Date(auth.expiresAt.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined)

function openVoiceCheck(again = false) {
  reenroll.value = again
  voiceCheckOpen.value = true
}

watch(savedKey, () => void auth.refresh(), { immediate: true })

// The owner's people: a key each, with their own chats, memories and voice print.
interface Person { id: string, name: string, owner: boolean, voicePrint: boolean, created: string }
const people = ref<Person[]>([])
const peopleError = ref<string>()
const newPersonName = ref('')
const shownKey = ref<{ name: string, token: string }>()

async function usersRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SERVER_URL}/api/v1/dahlia/users${path}`, {
    ...init,
    headers: dahliaHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined
    throw new Error(body?.error?.message ?? `Dahlia's server answered ${response.status}.`)
  }
  return response
}

async function loadPeople() {
  if (!isOwner.value || !auth.session.value)
    return
  peopleError.value = undefined
  try {
    people.value = (await (await usersRequest('')).json() as { users: Person[] }).users
  }
  catch (error) {
    peopleError.value = errorMessageFrom(error) ?? 'The people couldn\'t be loaded.'
  }
}

async function peopleAction(action: () => Promise<unknown>) {
  peopleError.value = undefined
  try {
    await action()
  }
  catch (error) {
    peopleError.value = errorMessageFrom(error) ?? 'That didn\'t work.'
  }
  await loadPeople()
}

function addPerson() {
  const name = newPersonName.value.trim()
  if (!name)
    return
  void peopleAction(async () => {
    const created = await (await usersRequest('', { method: 'POST', body: JSON.stringify({ name }) })).json() as { name: string, token: string }
    shownKey.value = created
    newPersonName.value = ''
  })
}

function newKeyFor(person: Person) {
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Make a new key for ${person.name}? Their old key stops working at once.`))
    return
  void peopleAction(async () => {
    const { token } = await (await usersRequest(`/${person.id}/token`, { method: 'POST' })).json() as { token: string }
    shownKey.value = { name: person.name, token }
  })
}

function resetVoicePrint(person: Person) {
  // eslint-disable-next-line no-alert
  if (window.confirm(`Forget ${person.name}'s voice print? They record it again with their key.`))
    void peopleAction(() => usersRequest(`/${person.id}/voice-print`, { method: 'DELETE' }))
}

function removePerson(person: Person) {
  // eslint-disable-next-line no-alert
  if (window.confirm(`Remove ${person.name}? Their key stops working; their chats and memories stay on the server.`))
    void peopleAction(() => usersRequest(`/${person.id}`, { method: 'DELETE' }))
}

async function copyShownKey() {
  if (shownKey.value)
    await navigator.clipboard.writeText(shownKey.value.token).catch(() => undefined)
}

watch([isOwner, auth.session], () => void loadPeople(), { immediate: true })

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

    <section v-if="isOwner && auth.session.value" :class="['flex flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        People
      </h2>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        Give someone their own key for Dahlia's apps. Dahlia knows who she talks with: each person has their own chats and memories, records their own voice print, and can't use your notes, your PC or your Discord.
      </p>
      <div :class="['flex flex-wrap items-end gap-2']">
        <div :class="['min-w-60 flex-1']">
          <FieldInput v-model="newPersonName" label="Name" placeholder="Their name" />
        </div>
        <Button icon="i-solar:user-plus-bold-duotone" label="Make a key" :disabled="!newPersonName.trim()" @click="addPerson" />
      </div>
      <div v-if="shownKey" :class="['flex flex-col gap-2 rounded-xl bg-neutral-100 p-3 dark:bg-neutral-800']">
        <p :class="['text-sm']">
          {{ shownKey.name }}'s key. It is shown only now: give it to them privately.
        </p>
        <code :class="['break-all text-xs']">{{ shownKey.token }}</code>
        <div :class="['flex flex-wrap gap-2']">
          <Button icon="i-solar:copy-bold-duotone" label="Copy" @click="copyShownKey" />
          <Button label="Done" @click="shownKey = undefined" />
        </div>
      </div>
      <p v-if="peopleError" role="status" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ peopleError }}
      </p>
      <ul :class="['flex flex-col gap-2']">
        <li v-for="person in people.filter(p => !p.owner)" :key="person.id" :class="['flex flex-wrap items-center justify-between gap-2 text-sm']">
          <span>{{ person.name }} <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ person.voicePrint ? 'voice print recorded' : 'no voice print yet' }}</span></span>
          <span :class="['flex flex-wrap gap-3 text-xs']">
            <button type="button" :class="['underline']" @click="newKeyFor(person)">New key</button>
            <button v-if="person.voicePrint" type="button" :class="['underline']" @click="resetVoicePrint(person)">Forget voice print</button>
            <button type="button" :class="['text-red-600 underline dark:text-red-400']" @click="removePerson(person)">Remove</button>
          </span>
        </li>
      </ul>
      <p v-if="people.filter(p => !p.owner).length === 0" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        Nobody else has a key yet.
      </p>
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

    <section v-if="isDesktop" :class="['flex flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        Dark War: Survival
      </h2>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        Dahlia plays the game in its window on this PC: she looks at the window, makes one move every few seconds and keeps notes about the game for next time. Keep the game open in its portrait window; it may be behind other windows. She uses the mouse for a moment with each move, so the PC is hers while she plays. She never buys anything, but the game's rules may not allow automated play, and an account could be banned for it.
      </p>
      <FieldInput v-model="gameWindowTitle" label="Game window title" description="Text in the title of the game's window." placeholder="Dark War" />
      <FieldTextArea v-model="gameGoal" label="What to do" :rows="3" />
      <FieldInput v-model="gameMinutes" type="number" label="Minutes" description="How long she plays. Leave empty for no limit: she plays until she is done or you stop her." placeholder="No limit" />
      <div :class="['flex flex-wrap gap-2']">
        <Button variant="primary" icon="i-solar:gamepad-bold-duotone" :label="gameStatus?.running ? 'Update goal and time' : 'Start playing'" @click="requestGame('start')" />
        <Button v-if="gameStatus?.running" icon="i-solar:stop-bold-duotone" label="Stop" @click="requestGame('stop')" />
      </div>
      <p role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ gameStatus?.running ? `Playing: ${gameStatus.steps} moves so far.` : (gameStatus?.ended ?? 'Not playing.') }}
      </p>
      <ul v-if="gameStatus?.log?.length" :class="['flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400']">
        <li v-for="(line, index) in gameStatus.log.slice().reverse()" :key="index">
          {{ line }}
        </li>
      </ul>

      <h3 :class="['text-base font-semibold']">
        Watch me play
      </h3>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        Dahlia learns the game from you. While the game's window is in front, each of your clicks and drags in it is kept with the screen before and after it, on Dahlia's server. She describes some of them as you play and writes down what she learned when watching ends. Clicks outside the game window and your keys are not recorded, and nothing is captured while another window is in front.
      </p>
      <FieldInput v-model="watchMinutes" type="number" label="Minutes" description="How long she watches (at most 240)." placeholder="60" />
      <div :class="['flex flex-wrap gap-2']">
        <Button variant="primary" icon="i-solar:eye-bold-duotone" :label="watchStatus?.running ? 'Update time' : 'Watch me play'" @click="requestGame('watch')" />
        <Button v-if="watchStatus?.running" icon="i-solar:stop-bold-duotone" label="Stop watching" @click="requestGame('watch-stop')" />
      </div>
      <p role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ watchStatus?.running ? `Watching: ${watchStatus.samples} clicks kept so far.` : (watchStatus?.ended ?? 'Not watching.') }}
      </p>
      <ul v-if="watchStatus?.log?.length" :class="['flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400']">
        <li v-for="(line, index) in watchStatus.log.slice().reverse()" :key="index">
          {{ line }}
        </li>
      </ul>
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
        Dahlia can run commands on your other machines over SSH from this PC. She logs in with this PC's key, or with a password you save here: it is kept encrypted on this PC, and she never sees or sends it. The first connection to a server trusts its host key; if the key changes later, she refuses to connect.
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

    <section v-if="savedKey" :class="['flex flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        Her memories
      </h2>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        What Dahlia remembers is on her server, the same in both apps, on Discord and on Twitch. See it, add to it or turn it off under Long-Term Memory.
      </p>
      <div>
        <RouterLink to="/settings/modules/memory-long-term-memories" :class="['text-sm text-primary-600 underline dark:text-primary-400']">
          Open her memories
        </RouterLink>
      </div>
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
