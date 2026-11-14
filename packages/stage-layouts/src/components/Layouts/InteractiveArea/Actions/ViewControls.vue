<script lang="ts" setup>
import { defaultControlConfig as threeCtrlConf, supportedControl as threeSupportedControl, useThreeViewControl } from '@proj-airi/stage-ui-three'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatToolbarButton from '../../../Widgets/ChatToolbarButton.vue'

const props = withDefaults(defineProps<{
  variant?: 'desktop' | 'mobile-stage'
}>(), {
  variant: 'desktop',
})

const { t } = useI18n()

const { stageModelRenderer } = storeToRefs(useSettingsStageModel())
const { viewControlsEnabled: threeSliderCtrlEnabled, viewControlMode: threeCtrlMode, set: threeSet } = useThreeViewControl()
const controlEnabled = computed(() => {
  if (stageModelRenderer.value === 'vrm')
    return { enabled: threeSliderCtrlEnabled, mode: threeCtrlMode }
  return null
})

const visibleControls = computed(() => {
  if (!controlEnabled.value)
    return []

  return threeSupportedControl
})

function isThreeControl(targetMode: string): targetMode is typeof threeSupportedControl[number] {
  return threeSupportedControl.includes(targetMode as typeof threeSupportedControl[number])
}

function controlLabel(control: string) {
  if (stageModelRenderer.value === 'vrm' && isThreeControl(control))
    return threeCtrlConf[control].buttonText

  return control
}

function handleViewControlsToggle(targetMode: string) {
  if (stageModelRenderer.value === 'vrm' && isThreeControl(targetMode)) {
    if (threeCtrlMode.value === targetMode)
      threeSet(targetMode)
    else
      threeCtrlMode.value = targetMode
  }
}
</script>

<template>
  <div :class="['w-full flex items-center self-end justify-end gap-2', props.variant === 'desktop' && 'flex-1']">
    <Transition name="fade">
      <div v-if="controlEnabled?.enabled.value" :class="['w-full flex justify-between gap-2']">
        <Button
          v-for="control in visibleControls"
          :key="control"
          :aria-pressed="controlEnabled.mode.value === control"
          :color="controlEnabled.mode.value === control ? 'primary' : 'neutral'"
          variant="secondary"
          block
          @click="handleViewControlsToggle(control)"
        >
          {{ controlLabel(control) }}
        </Button>
      </div>
    </Transition>
    <ChatToolbarButton
      v-if="props.variant === 'desktop'"
      :title="t('stage.mobile-tools.view')"
      :aria-label="t('stage.mobile-tools.view')"
      :aria-pressed="controlEnabled?.enabled.value"
      @click="controlEnabled && (controlEnabled.enabled.value = !controlEnabled.enabled.value)"
    >
      <Transition name="fade" mode="out-in">
        <div v-if="controlEnabled?.enabled.value" i-solar:alt-arrow-right-outline size-5 />
        <div v-else i-solar:tuning-outline size-5 />
      </Transition>
    </ChatToolbarButton>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease-in-out;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-to,
.fade-leave-from {
  opacity: 1;
}
</style>
