<script setup lang="ts">
import { ThreeScene } from '@proj-airi/stage-ui-three'
import { useMouse } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useSettings } from '../../../../stores/settings'

// Dahlia: her VRM is the only model, so this view renders the VRM scene alone. The fullscreen window uses it.
const props = defineProps<{
  vrmSceneClass?: string | string[]
}>()

const { stageModelSelected, stageModelSelectedUrl, stageModelRenderer } = storeToRefs(useSettings())
const vrmSceneClassList = computed(() => typeof props.vrmSceneClass === 'string' ? [props.vrmSceneClass] : props.vrmSceneClass ?? [])

const { x: mouseX, y: mouseY } = useMouse()
const cursorPosition = computed(() => ({
  x: mouseX.value,
  y: mouseY.value,
}))
</script>

<template>
  <div v-if="stageModelRenderer === 'vrm'" :class="vrmSceneClassList">
    <ThreeScene :cursor-position="cursorPosition" :model-id="stageModelSelected" :model-src="stageModelSelectedUrl" />
  </div>
</template>
