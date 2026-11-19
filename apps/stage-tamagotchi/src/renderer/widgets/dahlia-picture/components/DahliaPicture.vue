<script setup lang="ts">
// Dahlia: one of her drawings floating on the desktop, in a widget window of its own (src/renderer/dahlia-floating-
// pictures.ts opens it). The picture fills the window; its words show on hover, and it can be saved or set as the
// stage background. After the image widgets of dasilva333/airi. This file is Dahlia's (AIRI has no such file).
import { useDahliaPictureBackground } from '@proj-airi/stage-ui/composables/use-dahlia-picture-background'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** The picture's address on her server; it opens without the key. */
  src?: string
  /** The words she drew it from. */
  caption?: string
}>()

const { t } = useI18n()
const { setPictureAsBackground } = useDahliaPictureBackground()
const failed = shallowRef(false)
const note = shallowRef<string>()

async function useAsBackground() {
  if (!props.src)
    return
  try {
    await setPictureAsBackground(props.src, props.caption ?? '')
    note.value = t('stage.chat.history-actions.background-done')
  }
  catch (error) {
    note.value = t('stage.chat.history-actions.background-failed', { error: error instanceof Error ? error.message : String(error) })
  }
}

function save() {
  if (!props.src)
    return
  const link = document.createElement('a')
  link.href = props.src
  link.download = `dahlia-${props.src.split('/').pop() ?? 'picture.png'}`
  link.click()
}
</script>

<template>
  <div data-testid="dahlia-picture-widget" :class="['group relative h-full w-full overflow-hidden rounded-2xl bg-neutral-950/80 shadow-[0_8px_24px_rgba(0,0,0,0.4)]']">
    <img
      v-if="src && !failed"
      :src="src"
      :alt="caption || t('stage.chat.images.description')"
      draggable="false"
      :class="['h-full w-full select-none object-contain']"
      @error="failed = true"
    >
    <div v-else :class="['h-full flex items-center justify-center p-4 text-center text-sm text-neutral-300']">
      {{ t('stage.chat.floating.missing') }}
    </div>
    <div
      :class="[
        'absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-2.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100',
        'bg-gradient-to-t from-black/75 to-transparent text-white',
      ]"
    >
      <p v-if="caption" :class="['m-0 line-clamp-3 text-xs leading-snug']">
        {{ caption }}
      </p>
      <p v-if="note" role="status" :class="['m-0 text-[11px] opacity-80']">
        {{ note }}
      </p>
      <div :class="['flex gap-1.5']">
        <button
          type="button"
          :class="['rounded-md bg-white/15 px-2 py-1 text-[11px] hover:bg-white/25']"
          @click="useAsBackground"
        >
          {{ t('stage.chat.imagine.background') }}
        </button>
        <button
          type="button"
          :class="['rounded-md bg-white/15 px-2 py-1 text-[11px] hover:bg-white/25']"
          @click="save"
        >
          {{ t('stage.chat.floating.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
