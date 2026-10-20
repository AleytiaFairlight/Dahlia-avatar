<script setup lang="ts">
// Dahlia: the one AI setting the apps have, the Dahlia key. The apps chat and speak only through
// Dahlia's server, so there is no provider or model to choose. This page is Dahlia's (AIRI has no
// such page); scripts/apply_avatar_branding.sh points the chat's "configure" links here and hides
// AIRI's provider and model choosers.
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Button, FieldInput } from '@proj-airi/ui'
import { computed, ref } from 'vue'

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
