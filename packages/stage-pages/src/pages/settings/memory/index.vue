<script setup lang="ts">
// Dahlia: AIRI's Memory page is still a placeholder. Dahlia's memory is under Long-Term Memory, so this entry opens
// that page instead of a page with nothing on it.
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
onMounted(() => void router.replace('/settings/modules/memory-long-term'))
</script>

<template>
  <div />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.memory.description
  icon: i-solar:leaf-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
