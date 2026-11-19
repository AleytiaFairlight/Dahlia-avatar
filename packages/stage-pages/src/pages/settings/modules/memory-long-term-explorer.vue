<script setup lang="ts">
// Dahlia: her memories as a map and a timeline (stage-ui components/modules/DahliaMemoryExplorer.vue).
// This file is Dahlia's (AIRI has no such file).
import { DahliaMemoryExplorer } from '@proj-airi/stage-ui/components/modules/dahlia-memory-explorer'
</script>

<template>
  <DahliaMemoryExplorer />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.explorer.title
  subtitleKey: settings.pages.modules.memory-long-term.title
  stageTransition:
    name: slide
</route>
