<script setup lang="ts">
// Dahlia: the quick chat beside the tray icon (src/main/windows/dahlia-quick-chat). The desktop chat and a slim bar
// to drag it, pin it (it stays when another window takes the focus), open the full chat or close it.
// This file is Dahlia's (AIRI has no such file).
import { useBackdropSurface } from '@proj-airi/stage-ui/composables/backdrop-surface'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'
import { onMounted, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import InteractiveArea from '../components/InteractiveArea.vue'

const { t } = useI18n()
const { activeCard } = storeToRefs(useAiriCardStore())
const pinned = shallowRef(false)
useBackdropSurface(useTemplateRef<HTMLElement>('surface'))

async function quickChat(op: 'pin' | 'pinned' | 'hide' | 'full') {
  const answer = await window.electron.ipcRenderer.invoke('dahlia:quick-chat', op) as boolean | undefined
  if (typeof answer === 'boolean')
    pinned.value = answer
}

onMounted(() => void quickChat('pinned'))

const buttonClass = [
  'size-7 flex items-center justify-center rounded-md transition-colors [-webkit-app-region:no-drag]',
  'text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100',
]
</script>

<template>
  <div
    ref="surface"
    data-testid="dahlia-quick-chat"
    :class="['h-full w-full flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950']"
  >
    <div :class="['flex shrink-0 items-center gap-1 px-2 py-1.5 [-webkit-app-region:drag]']">
      <span :class="['i-solar:chat-line-bold size-4 text-primary-500']" aria-hidden="true" />
      <span :class="['flex-1 truncate text-sm font-medium text-neutral-700 dark:text-neutral-200']">{{ activeCard?.name || 'Dahlia' }}</span>
      <button
        type="button"
        data-testid="dahlia-quick-chat-pin"
        :class="[buttonClass, pinned && 'text-primary-600 dark:text-primary-300']"
        :aria-pressed="pinned"
        :title="pinned ? t('tamagotchi.stage.controls-island.unpin-from-top') : t('tamagotchi.stage.controls-island.pin-on-top')"
        :aria-label="pinned ? t('tamagotchi.stage.controls-island.unpin-from-top') : t('tamagotchi.stage.controls-island.pin-on-top')"
        @click="quickChat('pin')"
      >
        <span :class="[pinned ? 'i-solar:pin-bold' : 'i-solar:pin-linear', 'size-4']" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="buttonClass"
        :title="t('tamagotchi.stage.quick-chat.full')"
        :aria-label="t('tamagotchi.stage.quick-chat.full')"
        @click="quickChat('full')"
      >
        <span :class="['i-solar:maximize-square-minimalistic-linear size-4']" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="buttonClass"
        :title="t('tamagotchi.stage.quick-chat.close')"
        :aria-label="t('tamagotchi.stage.quick-chat.close')"
        @click="quickChat('hide')"
      >
        <span :class="['i-solar:close-circle-linear size-4']" aria-hidden="true" />
      </button>
    </div>
    <InteractiveArea :class="['min-h-0 flex-1']" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
