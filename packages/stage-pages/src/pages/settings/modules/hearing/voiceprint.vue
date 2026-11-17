<script setup lang="ts">
import { DahliaVoiceprintPanel } from '@proj-airi/stage-ui/components/scenarios/dialogs/dahlia-voice-check/mount'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useVoiceprintStore } from '@proj-airi/stage-ui/stores/voiceprint'
import { FieldCheckbox, SettingsCard } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

// Dahlia: the voice check records the voiceprint, from the sentences read there, so a person binds their voice once.
const { t } = useI18n()
const voiceprints = useVoiceprintStore()
const { speakerRecognitionEnabled } = storeToRefs(useHearingStore())
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <SettingsCard>
      <div :class="['flex flex-col gap-2 text-sm', 'text-neutral-500 dark:text-neutral-400']">
        <p>{{ t('settings.pages.modules.hearing.voiceprint.intro') }}</p>
        <p>{{ t('settings.pages.modules.hearing.voiceprint.privacy') }}</p>
      </div>
    </SettingsCard>

    <DahliaVoiceprintPanel />

    <SettingsCard>
      <!-- The setting keeps its value without a usable voiceprint, but the voice host compares nothing then. -->
      <FieldCheckbox
        v-model="speakerRecognitionEnabled"
        data-testid="speaker-recognition"
        :disabled="!voiceprints.voiceprint"
        :label="t('settings.pages.modules.hearing.voiceprint.speaker-recognition.label')"
        :description="t('settings.pages.modules.hearing.voiceprint.speaker-recognition.description')"
      />
      <p v-if="!voiceprints.voiceprint" :class="['text-xs', 'text-neutral-400 dark:text-neutral-500']">
        {{ t('settings.pages.modules.hearing.voiceprint.speaker-recognition.needs-voiceprint') }}
      </p>
    </SettingsCard>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.hearing.voiceprint.title
  subtitleKey: settings.pages.modules.hearing.title
  icon: i-solar:user-speak-rounded-bold-duotone
  stageTransition:
    name: slide
</route>
