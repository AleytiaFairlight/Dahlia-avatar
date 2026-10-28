<script setup lang="ts">
// Dahlia: the Android app's updater page, like the desktop app's (Settings > System > Developer > Updater). It shows
// where updating stands, the automatic hourly checks included, and updates on request. This file is Dahlia's (AIRI
// has no such file); scripts/apply_avatar_branding.sh adds it to the Developer page's list.
import { Button } from '@proj-airi/ui'
import { computed, ref } from 'vue'

import { dahliaUpdateStatus as status, updateDahliaNow } from '../../dahlia-updater'

const busy = computed(() => status.phase === 'checking' || status.phase === 'downloading' || status.phase === 'installing')
const pressed = ref(false)

const summary = computed(() => {
  const available = status.available ?? 'the new version'
  switch (status.phase) {
    case 'idle': return 'Not checked yet since the app started.'
    case 'checking': return 'Looking for a newer release on Dahlia\'s server and GitHub…'
    case 'up-to-date': return `Up to date${status.available ? ` (the newest release is ${status.available})` : ''}.`
    case 'unreachable': return 'Neither Dahlia\'s server nor GitHub answered. Check the connection and try again.'
    case 'downloading': return `Downloading ${available} (about 280 MB). This can take a few minutes; keep the app open.`
    case 'installing': return `Handing ${available} to Android…`
    case 'when-hidden': return `${available} is ready. It installs by itself when you leave the app, and Dahlia starts again.`
    case 'confirm': return `${available} is ready. Confirm Android's "Update this app?" dialog, or tap its notification.`
    case 'asked-recently': return `${available} is downloaded, and Android already asked today. Tap the button to ask again.`
    case 'error': return `The update failed: ${status.error ?? 'no reason given'}`
  }
  return ''
})

const lastCheck = computed(() => status.at ? new Date(status.at).toLocaleString() : 'not yet')

async function update() {
  pressed.value = true
  await updateDahliaNow()
}
</script>

<template>
  <div :class="['flex flex-col gap-4', 'pb-12']">
    <div :class="['flex flex-wrap gap-2']">
      <Button
        :loading="busy"
        :disabled="busy"
        icon="i-solar:refresh-outline"
        label="Check and update now"
        @click="update()"
      />
    </div>

    <div
      :class="[
        'rounded-xl p-4',
        status.phase === 'error' || status.phase === 'unreachable'
          ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
          : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
      ]"
    >
      {{ summary }}
    </div>

    <dl :class="['grid grid-cols-[auto_1fr] gap-x-4 gap-y-1', 'text-sm text-neutral-600 dark:text-neutral-400']">
      <dt>Installed</dt>
      <dd>{{ status.installed ?? '…' }}</dd>
      <dt>Newest release</dt>
      <dd>{{ status.available ?? '…' }}</dd>
      <dt>State</dt>
      <dd>{{ status.phase }}</dd>
      <dt>Last check</dt>
      <dd>{{ lastCheck }}</dd>
    </dl>

    <p v-if="!pressed" :class="['text-xs text-neutral-500']">
      The app also looks for updates by itself when it starts, every hour while it runs, and when it comes back to the
      front, and shows how that went here.
    </p>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
