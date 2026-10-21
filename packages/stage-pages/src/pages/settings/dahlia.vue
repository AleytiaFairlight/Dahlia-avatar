<script setup lang="ts">
// Dahlia: the one AI setting the apps have, the Dahlia key. The apps chat and speak only through
// Dahlia's server, so there is no provider or model to choose. This page is Dahlia's (AIRI has no
// such page); scripts/apply_avatar_branding.sh points the chat's "configure" links here and hides
// AIRI's provider and model choosers. On a phone it also has her phone features (the assistant app and
// listening in the background); on a PC, whether her other devices may use it.
import type { DahliaPhoneStatus } from '@proj-airi/stage-ui/libs/dahlia-phone'

import { errorMessageFrom } from '@moeru/std'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useDahliaPhoneControls } from '@proj-airi/stage-ui/libs/dahlia-phone'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Button, FieldCheckbox, FieldInput } from '@proj-airi/ui'
import { useDocumentVisibility, useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'

const DAHLIA_PROVIDER_ID = 'dahlia'

const providerConfigStore = useProviderConfigStore()
const providerStore = useProviderStore()

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
const deviceName = useLocalStorage('dahlia/device-name', 'Windows PC')
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
    case 'error':
      return 'Dahlia\'s server isn\'t reachable right now; this PC tries again.'
    case 'off':
      return 'Off: your other devices can\'t use this PC.'
    default:
      return 'Connecting…'
  }
})

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
        Your other devices
      </h2>
      <FieldCheckbox
        v-model="remoteToolsEnabled"
        label="Let Dahlia use this PC from your other devices"
        description="Ask her on your phone (or on Discord) to find a file on this PC or to do something here. Reading files needs no confirmation; anything else asks on this PC first, and an allowed action runs without asking for 10 minutes."
      />
      <FieldInput
        v-model="deviceName"
        label="This PC's name"
        description="How Dahlia calls this PC on your other devices."
        placeholder="Windows PC"
      />
      <p role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ remoteToolsMessage }}
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
