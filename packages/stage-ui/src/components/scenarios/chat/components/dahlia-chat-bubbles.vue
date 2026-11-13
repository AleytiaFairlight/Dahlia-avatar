<script setup lang="ts">
// Dahlia: shows a text of hers as several bubbles, one a thought (libs/dahlia-chat-bubbles.ts). With one thought,
// or with the setting off, it is the plain text as before. assistant-item.vue uses it in place of its markdown
// renderer (scripts/apply_avatar_branding.sh puts it there). This file is Dahlia's (AIRI has no such file).
import { computed } from 'vue'

import { dahliaChatBubblesEnabled, splitDahliaBubbles } from '../../../../libs/dahlia-chat-bubbles'
import { MarkdownRenderer } from '../../../markdown'

const props = defineProps<{
  content: string
  streaming?: boolean
}>()

// Read once for a message: a change of the setting applies to the messages after it.
const enabled = dahliaChatBubblesEnabled()
const bubbles = computed(() => enabled ? splitDahliaBubbles(props.content) : [props.content])
</script>

<template>
  <MarkdownRenderer v-if="bubbles.length < 2" :content="content" :streaming="streaming" />
  <div v-else :class="['flex flex-col gap-1.5']">
    <div
      v-for="(bubble, index) in bubbles"
      :key="index"
      :class="['rounded-lg px-2.5 py-1.5', 'bg-white/45 dark:bg-white/6']"
    >
      <!-- Only the last bubble is still being written. -->
      <MarkdownRenderer :content="bubble" :streaming="streaming && index === bubbles.length - 1" />
    </div>
  </div>
</template>
