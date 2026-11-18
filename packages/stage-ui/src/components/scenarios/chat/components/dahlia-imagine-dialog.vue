<script setup lang="ts">
// Dahlia: the chat's Imagine button. The owner describes a picture and her image model draws it right away, without a
// chat turn (the Artistry page's drawing, from the chat box). The picture can join the owner's next message, become
// the stage background or open by itself. Only the owner's key can draw; the dialog says so for any other key.
// This file is Dahlia's (AIRI has no such file).
import type { DahliaPicture, DahliaPictureShape } from '../../../../libs/dahlia-image-generation'

import { errorMessageFromValue } from '@proj-airi/stage-shared'
import { Button } from '@proj-airi/ui'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { useDahliaPictureBackground } from '../../../../composables/use-dahlia-picture-background'
import { drawDahliaPicture, getDahliaImageStatus } from '../../../../libs/dahlia-image-generation'

const emit = defineEmits<{
  /** The picture, as a file for the composer's attachments. */
  (e: 'attach', file: File): void
}>()

const open = defineModel<boolean>('open', { default: false })

/** The chat takes images up to 3 MB; a larger picture goes as WebP. */
const ATTACH_LIMIT = 3 * 1024 * 1024
const SHAPES: DahliaPictureShape[] = ['square', 'portrait', 'landscape']

const { t } = useI18n()
const { setPictureAsBackground } = useDahliaPictureBackground()
const state = shallowRef<'checking' | 'ready' | 'unavailable'>('checking')
const prompt = shallowRef('')
const shape = shallowRef<DahliaPictureShape>('square')
const drawing = shallowRef(false)
const busy = shallowRef(false)
const picture = shallowRef<DahliaPicture>()
const error = shallowRef<string>()
let controller: AbortController | undefined

watch(open, async (isOpen) => {
  if (!isOpen) {
    controller?.abort()
    return
  }
  error.value = undefined
  state.value = 'checking'
  try {
    const status = await getDahliaImageStatus()
    state.value = status.connected && status.canDraw ? 'ready' : 'unavailable'
  }
  catch (reason) {
    state.value = 'unavailable'
    error.value = errorMessageFromValue(reason)
  }
}, { immediate: true })

async function draw() {
  const words = prompt.value.trim()
  if (!words || drawing.value)
    return
  controller?.abort()
  controller = new AbortController()
  drawing.value = true
  error.value = undefined
  picture.value = undefined
  try {
    picture.value = await drawDahliaPicture(words, { shape: shape.value, signal: controller.signal })
  }
  catch (reason) {
    if (!controller.signal.aborted)
      error.value = t('stage.chat.imagine.failed', { error: errorMessageFromValue(reason) })
  }
  finally {
    drawing.value = false
  }
}

function stop() {
  controller?.abort()
}

/** The picture's bytes, as WebP when the PNG is too large for the chat. */
async function pictureFile(url: string): Promise<File> {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`HTTP ${response.status}`)
  let blob = await response.blob()
  if (blob.size > ATTACH_LIMIT) {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('the picture could not be converted')), 'image/webp', 0.9))
  }
  const extension = blob.type === 'image/webp' ? 'webp' : 'png'
  return new File([blob], `imagined.${extension}`, { type: blob.type || 'image/png' })
}

async function attach() {
  if (!picture.value || busy.value)
    return
  busy.value = true
  try {
    emit('attach', await pictureFile(picture.value.url))
    open.value = false
  }
  catch (reason) {
    error.value = errorMessageFromValue(reason)
  }
  finally {
    busy.value = false
  }
}

async function useAsBackground() {
  if (!picture.value || busy.value)
    return
  busy.value = true
  try {
    await setPictureAsBackground(picture.value.url, prompt.value)
    toast.success(t('stage.chat.history-actions.background-done'))
  }
  catch (reason) {
    error.value = t('stage.chat.history-actions.background-failed', { error: errorMessageFromValue(reason) })
  }
  finally {
    busy.value = false
  }
}

function openPicture() {
  if (picture.value)
    window.open(picture.value.url, '_blank', 'noopener')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    void draw()
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm']" />
      <DialogContent
        data-testid="dahlia-imagine-dialog"
        :class="[
          'fixed left-1/2 top-1/2 z-[9999] max-h-[90dvh] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
          'flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900',
        ]"
      >
        <DialogTitle :class="['flex items-center gap-2 text-lg font-semibold']">
          <span :class="['i-solar:magic-stick-3-bold-duotone size-5 text-primary-500']" aria-hidden="true" />
          {{ t('stage.chat.imagine.title') }}
        </DialogTitle>
        <DialogDescription :class="['text-sm text-neutral-600 dark:text-neutral-300']">
          {{ t('stage.chat.imagine.description') }}
        </DialogDescription>

        <p v-if="state === 'checking'" role="status" :class="['text-sm text-neutral-500']">
          {{ t('stage.chat.imagine.checking') }}
        </p>
        <p v-else-if="state === 'unavailable'" role="alert" data-testid="dahlia-imagine-unavailable" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ t('stage.chat.imagine.unavailable') }}
        </p>

        <template v-if="state === 'ready'">
          <textarea
            v-model="prompt"
            data-testid="dahlia-imagine-prompt"
            rows="3"
            :placeholder="t('stage.chat.imagine.prompt')"
            :aria-label="t('stage.chat.imagine.prompt')"
            :disabled="drawing"
            :class="[
              'w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none',
              'focus:border-primary-500 dark:border-neutral-700 dark:bg-neutral-800',
            ]"
            @keydown="handleKeydown"
          />
          <div role="radiogroup" :aria-label="t('stage.chat.imagine.shape')" :class="['flex gap-2']">
            <button
              v-for="option in SHAPES"
              :key="option"
              type="button"
              role="radio"
              :aria-checked="shape === option"
              :disabled="drawing"
              :class="[
                'flex-1 rounded-lg border px-2 py-1.5 text-sm transition-colors',
                shape === option
                  ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-200'
                  : 'border-neutral-300 text-neutral-600 hover:border-primary-300 dark:border-neutral-700 dark:text-neutral-300',
              ]"
              @click="shape = option"
            >
              {{ t(`stage.chat.imagine.${option}`) }}
            </button>
          </div>
          <div :class="['flex justify-end gap-2']">
            <Button v-if="drawing" variant="secondary" size="sm" @click="stop">
              {{ t('stage.chat.imagine.stop') }}
            </Button>
            <Button variant="primary" size="sm" data-testid="dahlia-imagine-draw" :disabled="drawing || !prompt.trim()" @click="draw">
              {{ drawing ? t('stage.chat.imagine.drawing') : picture ? t('stage.chat.imagine.again') : t('stage.chat.imagine.draw') }}
            </Button>
          </div>

          <div v-if="drawing" role="status" :class="['flex h-40 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800']">
            <span :class="['i-svg-spinners:ring-resize size-8 text-primary-500']" aria-hidden="true" />
          </div>
          <template v-else-if="picture">
            <img :src="picture.url" :alt="prompt" data-testid="dahlia-imagine-picture" :class="['max-h-80 w-full rounded-xl object-contain']">
            <div :class="['flex flex-wrap justify-end gap-2']">
              <Button variant="secondary" size="sm" :disabled="busy" @click="openPicture">
                {{ t('stage.chat.imagine.open') }}
              </Button>
              <Button variant="secondary" size="sm" data-testid="dahlia-imagine-background" :disabled="busy" @click="useAsBackground">
                {{ t('stage.chat.imagine.background') }}
              </Button>
              <Button variant="primary" size="sm" data-testid="dahlia-imagine-attach" :disabled="busy" @click="attach">
                {{ t('stage.chat.imagine.attach') }}
              </Button>
            </div>
          </template>
        </template>

        <p v-if="error" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
          {{ error }}
        </p>
        <div :class="['flex justify-end']">
          <Button variant="secondary" size="sm" @click="open = false">
            {{ t('stage.chat.imagine.close') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
