<script setup lang="ts">
import { DahliaVision } from '@proj-airi/stage-ui/components/modules/dahlia-vision'
</script>

<template>
  <DahliaVision />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.vision.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
