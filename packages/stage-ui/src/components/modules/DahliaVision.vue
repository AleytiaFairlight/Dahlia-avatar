<script setup lang="ts">
// Dahlia: the Vision module card's page. The other page chose a separate vision provider and model to describe
// images for a chat model that can't see. Dahlia's own model sees images itself, on her server, so there is
// nothing to choose: this page says she is connected, what she can look at, and shows her watching of this PC's
// screen (libs/dahlia-screen-watch.ts), which the desktop app's main window runs.
// scripts/apply_avatar_branding.sh points settings/modules/vision at this file. This file is Dahlia's.
import type { DahliaScreenWatchState } from '../../libs/dahlia-screen-watch'

import { Alert, Button, SettingsCard } from '@proj-airi/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { DAHLIA_SCREEN_WATCH_COMMAND_KEY, DAHLIA_SCREEN_WATCH_STATUS_KEY } from '../../libs/dahlia-screen-watch'

const watch = ref<DahliaScreenWatchState>()

function read() {
  try {
    const saved = localStorage.getItem(DAHLIA_SCREEN_WATCH_STATUS_KEY)
    watch.value = saved ? JSON.parse(saved) as DahliaScreenWatchState : undefined
  }
  catch {
    watch.value = undefined
  }
}

// The main window watches; this page can be in the settings window, so it sends a command and reads the state.
function send(op: 'start' | 'stop', game = false) {
  const command = JSON.stringify({ op, game, at: Date.now() })
  localStorage.setItem(DAHLIA_SCREEN_WATCH_COMMAND_KEY, command)
  // In the main window itself no storage event arrives, so the page says it there too.
  window.dispatchEvent(new StorageEvent('storage', { key: DAHLIA_SCREEN_WATCH_COMMAND_KEY, newValue: command }))
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  read()
  timer = setInterval(read, 2000)
})
onBeforeUnmount(() => clearInterval(timer))

const until = computed(() => watch.value?.endsAt ? new Date(watch.value.endsAt).toLocaleTimeString() : '')
const lastLook = computed(() => watch.value?.lastLookAt ? new Date(watch.value.lastLookAt).toLocaleTimeString() : '')
</script>

<template>
  <SettingsCard>
    <Alert tone="success">
      <span :class="['flex items-center', 'gap-2']">
        <span :class="['i-solar:eye-bold-duotone', 'text-lg']" aria-hidden="true" />
        Connected to Dahlia's Vision module
      </span>
    </Alert>

    <p :class="['mt-4', 'text-sm', 'text-neutral-600 dark:text-neutral-300']">
      Dahlia sees images herself, on her server, so there is no vision provider or model to choose here. She looks at
      the pictures you send her and at the screenshots she takes with her tools.
    </p>

    <h2 :class="['mt-6', 'text-base font-semibold']">
      Watching your screen
    </h2>
    <p :class="['mt-2', 'text-sm', 'text-neutral-600 dark:text-neutral-300']">
      Ask her to keep an eye on your screen, or start it here. She looks every 15 seconds, or every second while you
      play a game; when the screen changed, she notes what it shows, and keeps her newest note in mind while you talk.
      Nothing is recorded or kept. She watches until you stop her.
    </p>

    <template v-if="watch">
      <p :class="['mt-3', 'text-sm']">
        <template v-if="watch.running">
          Watching {{ watch.source ?? 'the screen' }}{{ watch.game ? ' (game, every second)' : '' }}{{ until ? ` until ${until}` : '' }}: {{ watch.looks }} looks so far<template v-if="lastLook">
            , the last at {{ lastLook }}
          </template>.
        </template>
        <template v-else>
          Not watching. {{ watch.ended }}
        </template>
      </p>
      <p v-if="watch.error" :class="['mt-1', 'text-sm', 'text-red-600 dark:text-red-400']">
        {{ watch.error }}
      </p>
      <p v-if="watch.running && watch.lastSummary" :class="['mt-2', 'whitespace-pre-line', 'rounded-lg', 'bg-neutral-100 dark:bg-neutral-800', 'p-3', 'text-sm']">
        {{ watch.lastSummary }}
      </p>
      <div :class="['mt-3', 'flex', 'gap-2']">
        <template v-if="!watch.running">
          <Button size="sm" variant="primary" @click="send('start')">
            Start watching
          </Button>
          <Button size="sm" variant="secondary" @click="send('start', true)">
            Watch a game
          </Button>
        </template>
        <Button v-else size="sm" variant="secondary" @click="send('stop')">
          Stop watching
        </Button>
      </div>
    </template>
    <p v-else :class="['mt-3', 'text-sm', 'text-neutral-500 dark:text-neutral-400']">
      Watching the screen runs in the desktop app on a PC.
    </p>
  </SettingsCard>
</template>
