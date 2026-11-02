<script setup lang="ts">
// Dahlia: the Discord module card's page. AIRI's page asked for a Discord bot token for AIRI's own small Discord bot,
// which Dahlia doesn't run: her Discord bot lives on her server, with the same memories and settings as the apps,
// and needs nothing set up in an app. So this page says she is connected there, and how to talk with her in a voice
// chat. A token AIRI's page saved before is cleared, so it isn't kept on the device or sent anywhere.
// scripts/apply_avatar_branding.sh points settings/modules/messaging-discord at this file. This file is Dahlia's.
import { Alert, SettingsCard } from '@proj-airi/ui'
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'

import { useDiscordStore } from '../../stores/modules/discord'

const discordStore = useDiscordStore()

onMounted(() => {
  if (discordStore.token || discordStore.enabled)
    discordStore.resetState()
})
</script>

<template>
  <SettingsCard>
    <Alert tone="success">
      <span :class="['flex items-center', 'gap-2']">
        <span :class="['i-simple-icons:discord', 'text-lg']" aria-hidden="true" />
        Connected to Dahlia's Discord module
      </span>
    </Alert>

    <p :class="['mt-4', 'text-sm', 'text-neutral-600 dark:text-neutral-300']">
      Discord runs on Dahlia's server, not in this app, so there is nothing to set up here. On Discord she has the
      same <RouterLink to="/settings/modules/memory-long-term" :class="['underline']">
        long-term memory
      </RouterLink>
      and settings as in this app.
    </p>

    <h2 :class="['mt-6', 'text-base font-semibold']">
      Voice chats
    </h2>
    <ul :class="['mt-2', 'flex flex-col', 'gap-1.5', 'list-disc', 'pl-5', 'text-sm', 'text-neutral-600 dark:text-neutral-300']">
      <li>In a server, join a voice channel and type <code>.voicechat</code>: she joins and listens.</li>
      <li>
        Say "Dahlia" and then what you want. She writes what she heard into the voice channel's chat and answers there.
        Right after she answered you, you can go on without her name.
      </li>
      <li>Only what is said to her is written down, and no audio is kept.</li>
      <li><code>.voicechat stop</code> ends it. She also stops when everyone leaves, or after 30 minutes without being spoken to.</li>
    </ul>
  </SettingsCard>
</template>
