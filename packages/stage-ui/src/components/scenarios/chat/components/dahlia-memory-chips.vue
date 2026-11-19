<script setup lang="ts">
// Dahlia: the memories she had in mind for a reply, under it (libs/dahlia-memory-chips.ts). Folded to one chip that
// says how many; open, each memory with its kind, its date and its words. This file is Dahlia's (AIRI has no such file).
import type { DahliaUsedMemory } from '../../../../types/chat'

import { useLocalStorage } from '@vueuse/core'
import { computed, shallowRef } from 'vue'

import { DAHLIA_MEMORY_CHIPS_KEY, dahliaMemoryKindLabel } from '../../../../libs/dahlia-memory-chips'

const props = defineProps<{
  memories: DahliaUsedMemory[]
}>()

const shown = useLocalStorage(DAHLIA_MEMORY_CHIPS_KEY, true)
const open = shallowRef(false)
const count = computed(() => props.memories.length === 1 ? '1 memory' : `${props.memories.length} memories`)

function day(at: string | undefined) {
  if (!at)
    return ''
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <div v-if="shown && memories.length > 0" data-testid="dahlia-memory-chips" :class="['flex flex-col gap-1']">
    <button
      type="button"
      :aria-expanded="open"
      :class="[
        'w-fit flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors',
        'bg-primary-100/70 text-primary-700 hover:bg-primary-200/80',
        'dark:bg-primary-900/40 dark:text-primary-200 dark:hover:bg-primary-800/60',
      ]"
      :title="open ? 'Hide what she remembered' : 'What she remembered for this reply'"
      @click="open = !open"
    >
      <span :class="['i-solar:bookmark-circle-bold-duotone size-3.5']" aria-hidden="true" />
      <span>Remembered {{ count }}</span>
      <span :class="[open ? 'i-solar:alt-arrow-up-linear' : 'i-solar:alt-arrow-down-linear', 'size-3']" aria-hidden="true" />
    </button>
    <ul v-if="open" :class="['m-0 flex flex-col gap-1 p-0 list-none']">
      <li
        v-for="(memory, index) in memories"
        :key="index"
        :class="[
          'rounded-lg px-2 py-1 text-xs leading-snug',
          'bg-white/60 text-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-200',
        ]"
      >
        <span :class="['mr-1 rounded px-1 text-[10px] font-medium uppercase', 'bg-primary-200/60 text-primary-800 dark:bg-primary-800/60 dark:text-primary-100']">
          {{ dahliaMemoryKindLabel(memory.kind) }}
        </span>
        <span v-if="day(memory.at)" :class="['mr-1 text-[10px] text-neutral-500 dark:text-neutral-400']">{{ day(memory.at) }}</span>
        <span v-if="memory.speaker" :class="['mr-1 text-neutral-500 dark:text-neutral-400']">{{ memory.speaker }}:</span>
        <span>{{ memory.text }}</span>
      </li>
    </ul>
  </div>
</template>
