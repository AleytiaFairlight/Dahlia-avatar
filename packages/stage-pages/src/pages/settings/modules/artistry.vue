<script setup lang="ts">
import { DahliaArtistry } from '@proj-airi/stage-ui/components/modules/dahlia-artistry'
</script>

<template>
  <DahliaArtistry />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.artistry.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
