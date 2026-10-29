<script setup lang="ts">
// Dahlia: the one AI setting the apps have, the Dahlia key. The apps chat and speak only through
// Dahlia's server, so there is no provider or model to choose. This page is Dahlia's (AIRI has no
// such page); scripts/apply_avatar_branding.sh points the chat's "configure" links here and hides
// AIRI's provider and model choosers. On a phone it also has her phone features (the assistant app and
// listening in the background); on a PC, whether her other devices may use it and her game. In both apps
// it lists her memories, which her server keeps for Discord and the apps alike, the voice check (the
// second factor of the key) and, for the owner, the people she made keys for.
import type { DahliaPhoneStatus } from '@proj-airi/stage-ui/libs/dahlia-phone'

import { errorMessageFrom } from '@moeru/std'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { DahliaVoiceCheckDialog } from '@proj-airi/stage-ui/components/scenarios/dialogs/dahlia-voice-check/mount'
import { DAHLIA_DEVICE_NAME_KEY, dahliaSystemName } from '@proj-airi/stage-ui/libs/dahlia-device-name'
import { useDahliaPhoneControls } from '@proj-airi/stage-ui/libs/dahlia-phone'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { dahliaHeaders, signOutDahlia, useDahliaAuth } from '@proj-airi/stage-ui/stores/dahlia-auth'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Button, FieldCheckbox, FieldInput, FieldTextArea } from '@proj-airi/ui'
import { useDocumentVisibility, useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'

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
const remoteToolsUnattended = useLocalStorage('dahlia/remote-tools-unattended', false)
// The name her other devices see: empty means the system's name (the PC's host name, the phone's device name).
const deviceName = useLocalStorage(DAHLIA_DEVICE_NAME_KEY, '')
if (deviceName.value === 'Windows PC')
  deviceName.value = ''
const systemName = ref<string>()
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

function requestGame(action: 'start' | 'stop') {
  // A new value each time, so the main window hears it as a change.
  localStorage.setItem('dahlia/game-request', JSON.stringify({
    action,
    goal: gameGoal.value,
    windowTitle: gameWindowTitle.value,
    minutes: Number(gameMinutes.value) || undefined,
    at: Date.now(),
  }))
}

// Her memories, on her server.
interface Memory { id: number, kind: string, text: string, updatedAt: string, subject: string }
const DARK_WAR_SUBJECT = 'game:dark-war-survival'
const memories = ref<Memory[]>([])
const memoriesError = ref<string>()
const newMemory = ref('')
const memoryGroups = computed(() => [
  { title: 'About you', items: memories.value.filter(m => m.kind === 'fact') },
  { title: 'Conversations', items: memories.value.filter(m => m.kind === 'conversation') },
  { title: 'Dark War: Survival', items: memories.value.filter(m => m.kind === 'game') },
].filter(group => group.items.length > 0))

async function memoryRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SERVER_URL}/api/v1/dahlia/memories${path}`, {
    ...init,
    headers: dahliaHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(response.status === 401
      ? 'Dahlia\'s server didn\'t accept the key.'
      : response.status === 403 ? 'Pass the voice check to see her memories.' : `Dahlia's server answered ${response.status}.`)
  }
  return response
}

async function loadMemories() {
  if (!savedKey.value || !auth.session.value)
    return
  memoriesError.value = undefined
  try {
    // The owner's game notes are hers; everyone else has their own memories only.
    const subjects = isOwner.value ? ['owner', DARK_WAR_SUBJECT] : ['owner']
    const lists = await Promise.all(subjects.map(async (subject) => {
      const { memories: list } = await (await memoryRequest(`?subject=${encodeURIComponent(subject)}`)).json() as { memories: Omit<Memory, 'subject'>[] }
      return list.map(memory => ({ ...memory, subject }))
    }))
    memories.value = lists.flat()
  }
  catch (error) {
    memoriesError.value = errorMessageFrom(error) ?? 'Her memories couldn\'t be loaded.'
  }
}

async function forgetMemory(memory: Memory) {
  await memoryRequest(`/${memory.id}?subject=${encodeURIComponent(memory.subject)}`, { method: 'DELETE' }).catch(() => undefined)
  await loadMemories()
}

async function addMemory() {
  const text = newMemory.value.trim()
  if (!text)
    return
  await memoryRequest('', { method: 'POST', body: JSON.stringify({ text }) }).catch(() => undefined)
  newMemory.value = ''
  await loadMemories()
}

onMounted(() => void loadMemories())

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
watch(auth.session, () => void loadMemories())

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
        This key is {{ auth.me.value.name }}'s{{ auth.me.value.owner ? ', Dahlia\'s owner' : '' }}. Dahlia checks your voice every 6 hours on each device, so nobody else can use your key: your chats, memories and settings are yours.
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

    <section v-if="savedKey" :class="['flex flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        Her memories
      </h2>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        What Dahlia remembers, on her server, the same on Discord and in both apps. She remembers what you tell her to and, a few minutes after a conversation goes quiet, what it was about. Ask her to forget something, or delete it here.
      </p>
      <div :class="['flex flex-wrap items-end gap-2']">
        <div :class="['min-w-60 flex-1']">
          <FieldInput v-model="newMemory" label="Tell her to remember" placeholder="Aleytia's favourite colour is purple." />
        </div>
        <Button icon="i-solar:add-circle-bold-duotone" label="Remember" :disabled="!newMemory.trim()" @click="addMemory" />
        <Button icon="i-solar:refresh-bold-duotone" label="Reload" @click="loadMemories" />
      </div>
      <p v-if="memoriesError" role="status" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ memoriesError }}
      </p>
      <p v-else-if="memoryGroups.length === 0" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        She remembers nothing yet.
      </p>
      <div v-for="group in memoryGroups" :key="group.title" :class="['flex flex-col gap-2']">
        <h3 :class="['font-medium']">
          {{ group.title }}
        </h3>
        <ul :class="['flex flex-col gap-1']">
          <li v-for="memory in group.items" :key="`${memory.subject}-${memory.id}`" :class="['flex items-start justify-between gap-2 text-sm']">
            <span>{{ memory.text }} <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ memory.updatedAt.slice(0, 10) }}</span></span>
            <button
              type="button"
              :class="['shrink-0 text-xs text-red-600 underline dark:text-red-400']"
              :aria-label="`Forget: ${memory.text}`"
              @click="forgetMemory(memory)"
            >
              Forget
            </button>
          </li>
        </ul>
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
