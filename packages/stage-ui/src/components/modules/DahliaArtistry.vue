<script setup lang="ts">
// Dahlia: the Artistry module card's page. AIRI's page chose an image provider (ComfyUI, Replicate, Nano Banana) with
// its keys. Dahlia draws with her own image models, her Image Generation module on her server's side, so there is no
// provider to choose: this page says she is connected there, how drawing works, the module's state, and lets the
// owner try a picture with the image model of their choice (libs/dahlia-image-generation.ts). In the chat she draws
// with her draw_picture tool, with the image model the owner names.
// scripts/apply_avatar_branding.sh points settings/modules/artistry at this file. This file is Dahlia's.
import type { DahliaImageStatus, DahliaPicture, DahliaPictureShape } from '../../libs/dahlia-image-generation'

import { Alert, Button, FieldInput, FieldSelect, FieldTextArea, SelectTab, SettingsCard } from '@proj-airi/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { drawDahliaPicture, getDahliaImageStatus } from '../../libs/dahlia-image-generation'

const status = ref<DahliaImageStatus>()
const statusError = ref('')
const prompt = ref('')
const avoid = ref('')
const shape = ref<DahliaPictureShape>('square')
const chosen = ref('')
const drawing = ref(false)
const drawError = ref('')
const picture = ref<DahliaPicture>()
const startedAt = ref(0)
const now = ref(Date.now())

const shapes: { label: string, value: DahliaPictureShape }[] = [
  { label: 'Square', value: 'square' },
  { label: 'Portrait', value: 'portrait' },
  { label: 'Landscape', value: 'landscape' },
]

async function refresh() {
  try {
    status.value = await getDahliaImageStatus()
    statusError.value = ''
    const models = status.value.models ?? []
    if (!models.some(m => m.id === chosen.value))
      chosen.value = status.value.default ?? models[0]?.id ?? ''
  }
  catch (error) {
    statusError.value = error instanceof Error ? error.message : String(error)
  }
}

let controller: AbortController | undefined
async function draw() {
  if (!prompt.value.trim() || drawing.value)
    return
  drawing.value = true
  drawError.value = ''
  startedAt.value = Date.now()
  controller = new AbortController()
  try {
    picture.value = await drawDahliaPicture(prompt.value.trim(), { shape: shape.value, avoid: avoid.value.trim(), model: chosen.value || undefined, signal: controller.signal })
  }
  catch (error) {
    if (!controller.signal.aborted)
      drawError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    drawing.value = false
    void refresh()
  }
}

const elapsed = computed(() => drawing.value ? Math.max(0, Math.round((now.value - startedAt.value) / 1000)) : 0)
const model = computed(() => status.value?.model?.replace(/\.(gguf|safetensors)$/, ''))
const modelOptions = computed(() => (status.value?.models ?? []).map(m => ({ label: m.name, value: m.id })))
const lastAt = computed(() => status.value?.last ? new Date(status.value.last.at * 1000).toLocaleString() : '')

let timer: ReturnType<typeof setInterval> | undefined
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void refresh()
  timer = setInterval(refresh, 10_000)
  clock = setInterval(() => now.value = Date.now(), 1000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearInterval(clock)
  controller?.abort()
})
</script>

<template>
  <SettingsCard>
    <Alert :tone="status && !status.connected ? 'warning' : 'success'">
      <span :class="['flex items-center', 'gap-2']">
        <span :class="['i-solar:gallery-bold-duotone', 'text-lg']" aria-hidden="true" />
        Connected to Dahlia's Image Generation module
      </span>
    </Alert>

    <p :class="['mt-4', 'text-sm', 'text-neutral-600 dark:text-neutral-300']">
      Dahlia draws pictures with her own image model, on her server's side, so there is no image provider or key to
      set up here. Ask her in the chat to draw, paint or generate a picture: she says she is drawing it, and the
      picture appears under her message a few minutes later.
    </p>
    <p :class="['mt-2', 'text-sm', 'text-neutral-600 dark:text-neutral-300']">
      Her image model uses the graphics card that also runs her large model, so while she draws, her model server
      switches to light mode (her small model answers), and back to full mode after the picture. Her large model
      then takes about two minutes to load again.
    </p>

    <p v-if="statusError" :class="['mt-3', 'text-sm', 'text-red-600 dark:text-red-400']">
      {{ statusError }}
    </p>
    <p v-else-if="status && !status.connected" :class="['mt-3', 'text-sm', 'text-amber-600 dark:text-amber-400']">
      Dahlia's server can't reach her Image Generation module right now, so she can't draw until it is back.
    </p>
    <p v-else-if="status" :class="['mt-3', 'text-sm']">
      <template v-if="modelOptions.length > 1">
        {{ modelOptions.length }} image models.
      </template>
      <template v-else-if="model">
        Image model: {{ model }}.
      </template>
      <template v-if="status.busy">
        Drawing now<template v-if="status.waiting">
          , {{ status.waiting }} more waiting
        </template>.
      </template>
      <template v-else-if="status.last">
        The last picture took {{ Math.round(status.last.seconds) }} seconds ({{ lastAt }}).
      </template>
    </p>

    <template v-if="status?.canDraw">
      <h2 :class="['mt-6', 'text-base font-semibold']">
        Try it
      </h2>
      <div :class="['mt-3', 'flex flex-col', 'gap-4']">
        <FieldTextArea
          v-model="prompt"
          label="What to draw"
          description="In English, as fully as you like: who or what, how they look, the setting, the light and the style (anime illustration, watercolor, photo...)."
          placeholder="An anime illustration of a girl with long pink hair reading in a sunny library"
          :rows="3"
        />
        <FieldInput
          v-model="avoid"
          :required="false"
          label="Leave out"
          description="Optional: things that must not be in the picture."
          placeholder="text, watermark"
        />
        <FieldSelect
          v-if="modelOptions.length > 1"
          v-model="chosen"
          label="Image model"
          description="Which of her image models draws it. In the chat, name one to have her use it."
          :options="modelOptions"
        />
        <SelectTab v-model="shape" :options="shapes" size="sm" />
        <div :class="['flex items-center', 'gap-3']">
          <Button size="sm" variant="primary" :disabled="drawing || !prompt.trim()" @click="draw">
            {{ drawing ? `Drawing... ${elapsed}s` : 'Draw it' }}
          </Button>
        </div>
      </div>
      <p v-if="drawError" :class="['mt-3', 'text-sm', 'text-red-600 dark:text-red-400']">
        {{ drawError }}
      </p>
      <figure v-if="picture" :class="['mt-4']">
        <a :href="picture.url" target="_blank" rel="noopener">
          <img :src="picture.url" :alt="prompt" :class="['max-h-120', 'max-w-full', 'rounded-lg', 'shadow']">
        </a>
        <figcaption :class="['mt-2', 'text-xs', 'text-neutral-500 dark:text-neutral-400']">
          Drawn<template v-if="picture.model">
            by {{ picture.model }}
          </template> in {{ Math.round(picture.seconds) }} seconds<template v-if="picture.restoring">
            ; her large model is loading again for about two minutes
          </template>.
        </figcaption>
      </figure>
    </template>
    <p v-else-if="status" :class="['mt-4', 'text-sm', 'text-neutral-500 dark:text-neutral-400']">
      Only Aleytia's key can have pictures drawn, as each one takes Dahlia's large model offline for a few minutes.
    </p>
  </SettingsCard>
</template>
