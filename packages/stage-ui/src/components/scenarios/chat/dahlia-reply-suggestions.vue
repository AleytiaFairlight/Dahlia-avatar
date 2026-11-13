<script setup lang="ts">
// Dahlia: up to three replies to tap after an answer of hers (libs/dahlia-reply-suggestions.ts). A tap hands the
// text to the composer, which puts it in the message box; nothing is sent by itself. The desktop chat places it
// above its message box (scripts/apply_avatar_branding.sh adds it). This file is Dahlia's (AIRI has no such file).
import { onBeforeUnmount, ref } from 'vue'

import { dahliaReplySuggestionsEnabled, fetchDahliaReplies } from '../../../libs/dahlia-reply-suggestions'
import { useChatStore } from '../../../stores/chat'
import { dahliaHeaders } from '../../../stores/dahlia-auth'

const emit = defineEmits<{ pick: [text: string] }>()

const replies = ref<string[]>([])
const chat = useChatStore()
let said = ''
let asking: AbortController | undefined

function clear() {
  asking?.abort()
  asking = undefined
  replies.value = []
}

const stops = [
  chat.onBeforeSend(async (message) => {
    said = typeof message === 'string' ? message : ''
    clear()
  }),
  chat.onAssistantResponseEnd(async (message) => {
    clear()
    const answer = typeof message === 'string' ? message.trim() : ''
    if (!answer || !dahliaReplySuggestionsEnabled())
      return
    const request = new AbortController()
    asking = request
    const found = await fetchDahliaReplies({ said, answer }, dahliaHeaders({ 'Content-Type': 'application/json' }), request.signal)
    if (asking === request)
      replies.value = found
  }),
]
onBeforeUnmount(() => {
  clear()
  stops.forEach(stop => stop())
})

function pick(reply: string) {
  emit('pick', reply)
  replies.value = []
}
</script>

<template>
  <div v-if="replies.length > 0" :class="['flex flex-wrap gap-1.5', 'px-2 pt-1.5']">
    <button
      v-for="reply in replies"
      :key="reply"
      type="button"
      :class="[
        'max-w-full truncate rounded-full px-3 py-1 text-xs',
        'bg-primary-100/70 text-primary-700 hover:bg-primary-200/80',
        'dark:bg-primary-900/40 dark:text-primary-100 dark:hover:bg-primary-800/60',
        'transition-colors duration-150',
      ]"
      :title="reply"
      @click="pick(reply)"
    >
      {{ reply }}
    </button>
  </div>
</template>
