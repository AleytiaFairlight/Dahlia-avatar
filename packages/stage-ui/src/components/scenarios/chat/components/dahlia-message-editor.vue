<script setup lang="ts">
// Dahlia: edits a chat message in place, inside its bubble. Ctrl+Enter saves, Esc cancels. The owner's own message
// can also be saved and asked again. This file is Dahlia's (AIRI has no such file).
import { onMounted, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  /** The text that the edit starts from. */
  text: string
  /** Offers "Save and ask again", for the owner's own message. */
  resendable?: boolean
}>(), { resendable: false })

const emit = defineEmits<{
  (e: 'save', text: string, resend: boolean): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const draft = shallowRef(props.text)
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')

onMounted(() => {
  textarea.value?.focus()
  textarea.value?.setSelectionRange(draft.value.length, draft.value.length)
})

function save(resend: boolean) {
  if (!draft.value.trim())
    return
  emit('save', draft.value, resend)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancel')
  }
  else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    save(false)
  }
}
</script>

<template>
  <div data-testid="dahlia-message-editor" :class="['flex min-w-60 flex-col gap-1.5']" @pointerdown.stop @contextmenu.stop>
    <textarea
      ref="textarea"
      v-model="draft"
      data-testid="dahlia-message-editor-text"
      :aria-label="t('stage.chat.edit.label')"
      :class="[
        'max-h-[50vh] min-h-16 w-full resize-y rounded-lg border px-2 py-1.5 text-sm outline-none [field-sizing:content]',
        'border-neutral-300 bg-white/90 text-neutral-800 focus:border-primary-500',
        'dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-100',
      ]"
      @keydown="handleKeydown"
    />
    <div :class="['flex flex-wrap items-center justify-end gap-1.5 text-xs']">
      <span :class="['mr-auto text-neutral-500 dark:text-neutral-400']">{{ t('stage.chat.edit.hint') }}</span>
      <button
        type="button"
        :class="['rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700']"
        @click="emit('cancel')"
      >
        {{ t('stage.chat.edit.cancel') }}
      </button>
      <button
        v-if="resendable"
        type="button"
        data-testid="dahlia-message-editor-resend"
        :disabled="!draft.trim()"
        :class="['rounded-md px-2 py-1 text-primary-700 hover:bg-primary-100 disabled:opacity-50 dark:text-primary-200 dark:hover:bg-primary-900']"
        @click="save(true)"
      >
        {{ t('stage.chat.edit.resend') }}
      </button>
      <button
        type="button"
        data-testid="dahlia-message-editor-save"
        :disabled="!draft.trim()"
        :class="['rounded-md bg-primary-500 px-2 py-1 text-white hover:bg-primary-600 disabled:opacity-50']"
        @click="save(false)"
      >
        {{ t('stage.chat.edit.save') }}
      </button>
    </div>
  </div>
</template>
