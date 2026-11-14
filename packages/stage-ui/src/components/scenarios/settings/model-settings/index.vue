<script setup lang="ts">
import type { ModelSettingsRuntimeSnapshot } from './runtime'

import { ref } from 'vue'

import ModelSettingsPanel from './panel.vue'
import ModelSettingsPreviewStage from './preview-stage.vue'

import { createEmptyModelSettingsRuntimeSnapshot } from './runtime'

withDefaults(defineProps<{
  palette: string[]
  settingsClass?: string | string[]
  allowExtractColors?: boolean
  vrmSceneClass?: string | string[]
  spineSceneClass?: string | string[]
  tachieSceneClass?: string | string[]
  mmdSceneClass?: string | string[]
}>(), {
  allowExtractColors: true,
})

defineEmits<{
  (e: 'extractColorsFromModel'): void
}>()

const previewStageRef = ref<{ capturePreviewFrame: () => Promise<Blob | undefined> }>()
const runtimeSnapshot = ref<ModelSettingsRuntimeSnapshot>(createEmptyModelSettingsRuntimeSnapshot())
async function capturePreviewFrame() {
  return previewStageRef.value?.capturePreviewFrame()
}

function handleRuntimeSnapshotChanged(nextSnapshot: ModelSettingsRuntimeSnapshot) {
  runtimeSnapshot.value = nextSnapshot
}

defineExpose({
  capturePreviewFrame,
})
</script>

<template>
  <ModelSettingsPanel
    :allow-extract-colors="allowExtractColors"
    :palette="palette"
    :runtime-snapshot="runtimeSnapshot"
    :settings-class="settingsClass"
    @extract-colors-from-model="$emit('extractColorsFromModel')"
  />
  <ModelSettingsPreviewStage
    ref="previewStageRef"
    :vrm-scene-class="vrmSceneClass"
    :spine-scene-class="spineSceneClass"
    :tachie-scene-class="tachieSceneClass"
    :mmd-scene-class="mmdSceneClass"
    @runtime-snapshot-changed="handleRuntimeSnapshotChanged"
  />
</template>
