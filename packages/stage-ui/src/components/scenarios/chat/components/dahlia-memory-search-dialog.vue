<script setup lang="ts">
// Dahlia: a search of her memories from the chat (libs/dahlia-memory-chips.ts), found the way she recalls them:
// by words and by meaning. A memory can go into the message box, to ask her about it. Her memory list and its
// changes stay in Settings > Modules > Long-Term Memory. This file is Dahlia's (AIRI has no such file).
import type { DahliaFoundMemory } from '../../../../libs/dahlia-memory-chips'

import { errorMessageFromValue } from '@proj-airi/stage-shared'
import { Button } from '@proj-airi/ui'
import { watchDebounced } from '@vueuse/core'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { dahliaMemoryKindLabel, searchDahliaMemories } from '../../../../libs/dahlia-memory-chips'

const emit = defineEmits<{
  /** Text for the message box: the memory, to ask her about it. */
  (e: 'insert', text: string): void
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const query = shallowRef('')
const results = shallowRef<DahliaFoundMemory[]>()
const searching = shallowRef(false)
const error = shallowRef<string>()
let controller: AbortController | undefined

watch(open, (isOpen) => {
  if (!isOpen)
    controller?.abort()
})

watchDebounced(query, async (words) => {
  controller?.abort()
  const wanted = words.trim()
  if (wanted.length < 2) {
    results.value = undefined
    error.value = undefined
    return
  }
  const request = new AbortController()
  controller = request
  searching.value = true
  try {
    const found = await searchDahliaMemories(wanted, request.signal)
    if (controller === request) {
      results.value = found
      error.value = undefined
    }
  }
  catch (reason) {
    if (!request.signal.aborted)
      error.value = t('stage.chat.memory-search.failed', { error: errorMessageFromValue(reason) })
  }
  finally {
    if (controller === request)
      searching.value = false
  }
}, { debounce: 350 })

function insert(memory: DahliaFoundMemory) {
  emit('insert', t('stage.chat.memory-search.about', { memory: memory.text }))
  open.value = false
}

function day(at: string | undefined) {
  if (!at)
    return ''
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm']" />
      <DialogContent
        data-testid="dahlia-memory-search"
        :class="[
          'fixed left-1/2 top-1/2 z-[9999] max-h-[85dvh] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2',
          'flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900',
        ]"
      >
        <DialogTitle :class="['flex items-center gap-2 text-lg font-semibold']">
          <span :class="['i-solar:bookmark-circle-bold-duotone size-5 text-primary-500']" aria-hidden="true" />
          {{ t('stage.chat.memory-search.title') }}
        </DialogTitle>
        <DialogDescription :class="['text-sm text-neutral-600 dark:text-neutral-300']">
          {{ t('stage.chat.memory-search.description') }}
        </DialogDescription>
        <input
          v-model="query"
          type="search"
          data-testid="dahlia-memory-search-input"
          :placeholder="t('stage.chat.memory-search.placeholder')"
          :aria-label="t('stage.chat.memory-search.placeholder')"
          :class="[
            'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none',
            'focus:border-primary-500 dark:border-neutral-700 dark:bg-neutral-800',
          ]"
        >
        <div :class="['min-h-0 flex-1 overflow-y-auto']">
          <p v-if="searching" role="status" :class="['text-sm text-neutral-500']">
            {{ t('stage.chat.memory-search.searching') }}
          </p>
          <p v-else-if="error" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
            {{ error }}
          </p>
          <p v-else-if="results && results.length === 0" :class="['text-sm text-neutral-500']">
            {{ t('stage.chat.memory-search.none') }}
          </p>
          <ul v-else-if="results" :class="['m-0 flex flex-col gap-1.5 p-0 list-none']">
            <li
              v-for="memory in results"
              :key="`${memory.kind}-${memory.id}`"
              data-testid="dahlia-memory-search-result"
              :class="['flex items-start gap-2 rounded-lg px-2.5 py-2 text-sm', 'bg-neutral-100 dark:bg-neutral-800']"
            >
              <div :class="['min-w-0 flex-1']">
                <span :class="['mr-1 rounded px-1 text-[10px] font-medium uppercase', 'bg-primary-200/60 text-primary-800 dark:bg-primary-800/60 dark:text-primary-100']">
                  {{ dahliaMemoryKindLabel(memory.kind) }}
                </span>
                <span v-if="day(memory.at)" :class="['mr-1 text-xs text-neutral-500 dark:text-neutral-400']">{{ day(memory.at) }}</span>
                <span v-if="memory.speaker" :class="['mr-1 text-neutral-500 dark:text-neutral-400']">{{ memory.speaker }}:</span>
                <span :class="['break-words']">{{ memory.text }}</span>
              </div>
              <button
                type="button"
                :title="t('stage.chat.memory-search.ask')"
                :aria-label="t('stage.chat.memory-search.ask')"
                :class="['shrink-0 rounded-md p-1 text-primary-600 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-primary-900']"
                @click="insert(memory)"
              >
                <span :class="['i-solar:chat-round-dots-bold size-4']" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </div>
        <div :class="['flex justify-end']">
          <Button variant="secondary" size="sm" @click="open = false">
            {{ t('stage.chat.imagine.close') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
