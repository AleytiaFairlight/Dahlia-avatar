<script setup lang="ts">
// Dahlia: her memories are on her server, the same in both apps, on Discord and on Twitch, so this page lists those
// (stores/dahlia-memory.ts) instead of AIRI's memories on the device: what she knows about you, what your
// conversations were about and, for the owner, her game notes. You can tell her something to remember, or delete
// a memory. AIRI's page grouped memories kept on the device by character card.
import type { DahliaMemory } from '@proj-airi/stage-ui/stores/dahlia-memory'

import { useDahliaAuth } from '@proj-airi/stage-ui/stores/dahlia-auth'
import { useDahliaMemoryStore } from '@proj-airi/stage-ui/stores/dahlia-memory'
import { Button, FieldInput, GhostButton } from '@proj-airi/ui'
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { memorySearchKey } from './memory-long-term-memories.search'

const { t } = useI18n()
const memory = useDahliaMemoryStore()
const auth = useDahliaAuth()

const KEY = 'settings.pages.modules.memory-long-term.memories'
const newMemory = ref('')

async function remember() {
  const text = newMemory.value
  newMemory.value = ''
  await memory.add(text)
}

function forget(entry: DahliaMemory) {
  void memory.forget(entry)
}

onMounted(() => void memory.load())
watch(auth.session, () => void memory.load())
</script>

<template>
  <div :class="['flex flex-col', 'gap-4']">
    <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      {{ t(`${KEY}.description`) }}
    </p>
    <p v-if="!memory.enabled" role="status" :class="['rounded-lg', 'bg-amber-50 dark:bg-amber-900/30', 'px-3 py-2', 'text-sm', 'text-amber-800 dark:text-amber-200']">
      {{ t(`${KEY}.off`) }}
      <RouterLink to="/settings/modules/memory-long-term" :class="['underline']">
        {{ t('settings.pages.modules.memory-long-term.enable') }}
      </RouterLink>
    </p>

    <div :class="['flex flex-wrap items-end', 'gap-2']">
      <div :class="['min-w-60 flex-1']">
        <FieldInput v-model="newMemory" :label="t(`${KEY}.add`)" :placeholder="t(`${KEY}.add_placeholder`)" @keydown.enter="remember" />
      </div>
      <Button icon="i-solar:add-circle-bold-duotone" :label="t(`${KEY}.remember`)" :disabled="!newMemory.trim()" @click="remember" />
      <Button icon="i-solar:refresh-bold-duotone" :label="t(`${KEY}.reload`)" :disabled="memory.loading" @click="memory.load()" />
    </div>
    <p v-if="!auth.session.value" role="status" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      {{ t(`${KEY}.voice_check`) }}
    </p>
    <p v-else-if="memory.error" role="status" :class="['text-sm', 'text-red-600 dark:text-red-400']">
      {{ memory.error }}
    </p>

    <section
      v-for="group in memory.groups"
      v-show="group.key !== 'game' || group.items.length"
      :key="group.key"
      :class="['flex flex-col', 'gap-2', 'rounded-xl', 'bg-neutral-50 dark:bg-neutral-800/60', 'p-4']"
    >
      <h2 :class="['flex items-center', 'gap-2', 'text-sm font-medium']">
        <span :class="[group.icon, 'text-lg', 'text-primary-500 dark:text-primary-400']" aria-hidden="true" />
        <span :class="['min-w-0 flex-1', 'truncate']">{{ group.title }}</span>
        <span :class="['text-xs', 'text-neutral-400 dark:text-neutral-500']">{{ group.items.length }}</span>
      </h2>
      <ul v-if="group.items.length" :class="['flex flex-col', 'gap-2']">
        <li
          v-for="entry in group.items"
          :key="`${entry.subject}-${entry.id}`"
          :data-settings-search="memorySearchKey(entry)"
          :class="['flex items-start', 'gap-3', 'rounded-lg', 'bg-white dark:bg-neutral-900/60', 'px-3 py-2.5']"
        >
          <div :class="['min-w-0 flex-1', 'flex flex-col', 'gap-0.5']">
            <p :class="['text-sm', 'whitespace-pre-wrap break-words']">
              {{ entry.text }}
            </p>
            <span :class="['text-xs', 'text-neutral-400 dark:text-neutral-500']">{{ entry.updatedAt.slice(0, 10) }}</span>
          </div>
          <GhostButton size="sm" icon="i-solar:trash-bin-minimalistic-linear" :aria-label="t(`${KEY}.forget`, { name: entry.text })" :title="t(`${KEY}.forget`, { name: entry.text })" @click="forget(entry)" />
        </li>
      </ul>
      <p v-else :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">
        {{ t(`${KEY}.empty`) }}
      </p>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.memories.title
  subtitleKey: settings.pages.modules.memory-long-term.title
  stageTransition:
    name: slide
</route>
