<script setup lang="ts">
// Dahlia: the Hearing module's voiceprint page shows this instead of its own enrollment. The voiceprint is recorded
// by Dahlia's voice check, from sentences read aloud, on her server and on this device at once, so a person binds
// their voice once (scripts/apply_avatar_branding.sh puts it on the page). This file is Dahlia's (AIRI has no such file).
import { Button, DoubleCheckButton, SettingsCard } from '@proj-airi/ui'
import { computed, ref } from 'vue'

import DahliaVoiceCheckDialog from './dahlia-voice-check-dialog.vue'

import { useDahliaAuth } from '../../../../stores/dahlia-auth'
import { useVoiceprintStore } from '../../../../stores/voiceprint'

const voiceprints = useVoiceprintStore()
const auth = useDahliaAuth()
const open = ref(false)

const status = computed(() => {
  const record = voiceprints.record
  if (voiceprints.voiceprint && record)
    return `Your voiceprint is saved on this device, from ${Math.round(record.seconds)} seconds of speech on ${new Date(record.createdAt).toLocaleDateString()}.`
  if (voiceprints.outdated)
    return 'The voiceprint on this device is from an older voice model. Record it again.'
  return 'This device has no voiceprint yet. It is recorded at your next voice check, or now.'
})
</script>

<template>
  <SettingsCard>
    <div :class="['flex flex-col gap-3']">
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        Your voiceprint is recorded with Dahlia's voice check: you read sentences aloud, and she keeps your voice print on her server and on this device, so you bind your voice once.
      </p>
      <p data-testid="dahlia-voiceprint-status" :class="['font-medium text-neutral-700 dark:text-neutral-200']">
        {{ status }}
      </p>
      <div :class="['flex flex-wrap gap-2']">
        <Button
          variant="primary"
          icon="i-solar:microphone-3-bold-duotone"
          label="Record it again"
          :disabled="!auth.session.value"
          @click="open = true"
        />
        <!-- Only this device's: the server keeps its voice print for the check, and this device records one again at the next. -->
        <DoubleCheckButton v-if="voiceprints.record" data-testid="dahlia-voiceprint-delete" @confirm="voiceprints.remove()">
          Delete voiceprint
          <template #confirm>
            Delete
          </template>
          <template #cancel>
            Keep it
          </template>
        </DoubleCheckButton>
      </div>
    </div>
    <DahliaVoiceCheckDialog v-model="open" reenroll />
  </SettingsCard>
</template>
