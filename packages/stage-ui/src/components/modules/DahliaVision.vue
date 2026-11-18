<script setup lang="ts">
// Dahlia: the Vision module card's page. The other page chose a separate vision provider and model to describe
// images for a chat model that can't see. Dahlia's own model sees images itself, on her server, so there is
// nothing to choose: this page says she is connected, what she can look at, and shows her watching of this PC's
// screen (libs/dahlia-screen-watch.ts), which the desktop app's main window runs, with the words she looks out
// for (libs/dahlia-screen-attention.ts), the switch of her PC awareness (libs/dahlia-pc-awareness.ts) and, on a PC,
// her watching of Aleytia playing her game to learn it (libs/dahlia-game-watch.ts).
// scripts/apply_avatar_branding.sh points settings/modules/vision at this file. This file is Dahlia's.
import type { DahliaGameWatchState } from '../../libs/dahlia-game-watch'
import type { DahliaPcAwarenessState } from '../../libs/dahlia-pc-awareness'
import type { DahliaScreenWatchState } from '../../libs/dahlia-screen-watch'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { Alert, Button, FieldCheckbox, FieldInput, SettingsCard } from '@proj-airi/ui'
import { useLocalStorage } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { DAHLIA_PC_AWARENESS_KEY, DAHLIA_PC_AWARENESS_STATUS_KEY } from '../../libs/dahlia-pc-awareness'
import { DAHLIA_SCREEN_INTERESTS_KEY, describeAttention, parseInterests } from '../../libs/dahlia-screen-attention'
import { DAHLIA_SCREEN_WATCH_COMMAND_KEY, DAHLIA_SCREEN_WATCH_STATUS_KEY } from '../../libs/dahlia-screen-watch'

const watch = ref<DahliaScreenWatchState>()
const pc = ref<DahliaPcAwarenessState>()
const interests = ref('')
const interestsSaved = ref('')
const pcOn = ref(false)

// Watching Aleytia play, to learn her game: the desktop app's main window does it (src/renderer/dahlia-game-watch.ts)
// on a request in 'dahlia/game-request', which the Dark War: Survival page also writes to make her play, and keeps
// its state in 'dahlia/game-watch-status'. It watches the game window named on that page.
const isDesktop = isStageTamagotchi()
const gameWindowTitle = useLocalStorage('dahlia/game-window-title', 'DarkWar')
const gameWatchMinutes = useLocalStorage('dahlia/game-watch-minutes', '60')
const gameWatch = ref<DahliaGameWatchState>()

function stored<T>(key: string) {
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) as T : undefined
  }
  catch {
    return undefined
  }
}

// The main window reads both keys; a change made in the main window itself reaches it through the event.
function store(key: string, value: string) {
  localStorage.setItem(key, value)
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }))
}

function saveInterests() {
  const list = parseInterests(interests.value)
  store(DAHLIA_SCREEN_INTERESTS_KEY, JSON.stringify(list))
  interests.value = interestsSaved.value = list.join(', ')
}

function setPcAwareness(on: boolean) {
  pcOn.value = on
  store(DAHLIA_PC_AWARENESS_KEY, on ? 'on' : 'off')
}

function requestGameWatch(action: 'watch' | 'watch-stop') {
  // A new value each time, so the main window hears it as a change.
  store('dahlia/game-request', JSON.stringify({
    action,
    windowTitle: gameWindowTitle.value,
    minutes: Number(gameWatchMinutes.value) || undefined,
    at: Date.now(),
  }))
}

function read() {
  try {
    const saved = localStorage.getItem(DAHLIA_SCREEN_WATCH_STATUS_KEY)
    watch.value = saved ? JSON.parse(saved) as DahliaScreenWatchState : undefined
  }
  catch {
    watch.value = undefined
  }
  pc.value = stored<DahliaPcAwarenessState>(DAHLIA_PC_AWARENESS_STATUS_KEY)
  gameWatch.value = stored<DahliaGameWatchState>('dahlia/game-watch-status')
  pcOn.value = localStorage.getItem(DAHLIA_PC_AWARENESS_KEY) === 'on'
  // Her screen_watch tool can change the list too; a list being typed here is left alone.
  const saved = parseInterests(stored<string[]>(DAHLIA_SCREEN_INTERESTS_KEY)).join(', ')
  if (saved !== interestsSaved.value && interests.value === interestsSaved.value)
    interests.value = saved
  interestsSaved.value = saved
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
const lastReason = computed(() => describeAttention(watch.value?.lastReason))
const lastFiltered = computed(() => describeAttention(watch.value?.lastFiltered))
const pcFront = computed(() => [pc.value?.title, pc.value?.app && `(${pc.value.app})`].filter(Boolean).join(' '))
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
      Ask her to keep an eye on your screen, or start it here. Your PC takes a capture every 15 seconds, or every
      second while you play a game, and reads it first: she looks when another window came to the front, when most of
      the text changed, when something that looks like a problem appeared, or when a word you asked her to watch for
      appeared. She notes what the screen shows and keeps her newest note in mind while you talk. Nothing is recorded
      or kept. She watches until you stop her.
    </p>

    <template v-if="watch">
      <p :class="['mt-3', 'text-sm']">
        <template v-if="watch.running">
          Watching {{ watch.source ?? 'the screen' }}{{ watch.game ? ' (game, every second)' : '' }}{{ until ? ` until ${until}` : '' }}: {{ watch.looks }} looks so far<template v-if="lastLook">
            , the last at {{ lastLook }}
          </template><template v-if="lastReason">
            ({{ lastReason }})
          </template>.
          <template v-if="watch.filtered">
            {{ watch.filtered }} changed captures needed no look<template v-if="lastFiltered">
              (the last: {{ lastFiltered }})
            </template>.
          </template>
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

    <div :class="['mt-4']">
      <FieldInput
        v-model="interests"
        label="Words to watch for"
        description="Words or short phrases, with commas between them, such as: build failed, download complete, low health. When one appears on the screen she looks at once. You can also tell her what to watch for."
        placeholder="build failed, download complete"
      />
      <Button v-if="interests !== interestsSaved" :class="['mt-2']" size="sm" variant="secondary" @click="saveInterests">
        Save the words
      </Button>
    </div>

    <template v-if="isDesktop">
      <h2 :class="['mt-6', 'text-base font-semibold']">
        Watch me play
      </h2>
      <p :class="['mt-2', 'text-sm', 'text-neutral-600 dark:text-neutral-300']">
        Dahlia learns the game from you. While the game's window is in front, each of your clicks and drags in it is
        kept with the screen before and after it, on Dahlia's server. She describes some of them as you play and writes
        down what she learned when watching ends. Clicks outside the game window and your keys are not recorded, and
        nothing is captured while another window is in front. The game's window is the one named under Settings > Modules >
        Dark War: Survival.
      </p>
      <FieldInput
        v-model="gameWatchMinutes"
        :class="['mt-3']"
        type="number"
        label="Minutes"
        description="How long she watches (at most 240)."
        placeholder="60"
      />
      <div :class="['mt-3', 'flex', 'gap-2']">
        <Button size="sm" variant="primary" @click="requestGameWatch('watch')">
          {{ gameWatch?.running ? 'Update time' : 'Watch me play' }}
        </Button>
        <Button v-if="gameWatch?.running" size="sm" variant="secondary" @click="requestGameWatch('watch-stop')">
          Stop watching
        </Button>
      </div>
      <p role="status" :class="['mt-2', 'text-sm', 'text-neutral-500 dark:text-neutral-400']">
        {{ gameWatch?.running ? `Watching: ${gameWatch.samples} clicks kept so far.` : (gameWatch?.ended ?? 'Not watching.') }}
      </p>
      <ul v-if="gameWatch?.log?.length" :class="['mt-1', 'flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
        <li v-for="(line, index) in gameWatch.log.slice().reverse()" :key="index">
          {{ line }}
        </li>
      </ul>
    </template>

    <h2 :class="['mt-6', 'text-base font-semibold']">
      PC awareness
    </h2>
    <FieldCheckbox
      :model-value="pcOn"
      :class="['mt-2']"
      label="Let Dahlia know what I am doing on this PC"
      description="Your PC tells her which window is in front, whether you are at the keyboard, which apps you used in the last hour and today, how busy the processor, memory and graphics card are, your sound volume and your PC's time, so she knows without being told. Only she gets it, only while it is on, and it isn't kept. It is also on while she watches your screen."
      @update:model-value="setPcAwareness($event === true)"
    />
    <p v-if="pc?.running" :class="['mt-2', 'text-sm']">
      On{{ pcFront ? `: in front is ${pcFront}` : '' }}.
    </p>
    <p v-if="pc?.running && pc.error" :class="['mt-1', 'text-sm', 'text-red-600 dark:text-red-400']">
      {{ pc.error }}
    </p>
  </SettingsCard>
</template>
