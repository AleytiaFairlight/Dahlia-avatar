<script setup lang="ts">
import { DahliaDiscord } from '@proj-airi/stage-ui/components/modules/dahlia-discord'
</script>

<template>
  <DahliaDiscord />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.messaging-discord.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
