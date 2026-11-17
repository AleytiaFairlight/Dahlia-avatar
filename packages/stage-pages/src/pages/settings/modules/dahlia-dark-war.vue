<script setup lang="ts">
// Dahlia: Settings > Modules > Dark War: Survival, the game she plays on a PC. The desktop app's main window plays it
// (src/renderer/dahlia-game-player.ts with stage-ui libs/dahlia-game-player.ts); this page sends it requests through
// localStorage and shows its state. Watching Aleytia play, to learn the game, is on the Vision module's page (stage-ui
// components/modules/DahliaVision.vue) and watches the game window named here. This file is Dahlia's (AIRI has no such
// file); scripts/apply_avatar_branding.sh lists it among the modules, in the desktop app only.
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { Button, FieldInput, FieldTextArea } from '@proj-airi/ui'
import { useLocalStorage } from '@vueuse/core'

const isDesktop = isStageTamagotchi()
const DEFAULT_GAME_GOAL = 'Collect free rewards and resources, finish the daily quests, upgrade buildings and train troops.'
// The game's own window; "Dark War" is its launcher.
const gameWindowTitle = useLocalStorage('dahlia/game-window-title', 'DarkWar')
const gameGoal = useLocalStorage('dahlia/game-goal', DEFAULT_GAME_GOAL)
const gameMinutes = useLocalStorage('dahlia/game-minutes', '')
const gameStatus = useLocalStorage<{ running: boolean, steps: number, log: string[], ended?: string } | null>('dahlia/game-status', null, {
  serializer: { read: value => JSON.parse(value), write: value => JSON.stringify(value) },
})

function requestGame(action: 'start' | 'stop') {
  // A new value each time, so the main window hears it as a change.
  localStorage.setItem('dahlia/game-request', JSON.stringify({
    action,
    goal: gameGoal.value,
    windowTitle: gameWindowTitle.value,
    minutes: Number(gameMinutes.value) || undefined,
    at: Date.now(),
  }))
}
</script>

<template>
  <div v-if="isDesktop" :class="['flex flex-col', 'gap-4', 'pb-12']">
    <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      Dahlia plays the game in its window on this PC: she looks at the window, makes one move every few seconds and keeps notes about the game for next time. Keep the game open in its portrait window; it may be behind other windows. She uses the mouse for a moment with each move, so the PC is hers while she plays. She never buys anything, but the game's rules may not allow automated play, and an account could be banned for it.
    </p>
    <FieldInput v-model="gameWindowTitle" label="Game window title" description="Text in the title of the game's window." placeholder="Dark War" />
    <FieldTextArea v-model="gameGoal" label="What to do" :rows="3" />
    <FieldInput v-model="gameMinutes" type="number" label="Minutes" description="How long she plays. Leave empty for no limit: she plays until she is done or you stop her." placeholder="No limit" />
    <div :class="['flex flex-wrap', 'gap-2']">
      <Button variant="primary" icon="i-solar:gamepad-bold-duotone" :label="gameStatus?.running ? 'Update goal and time' : 'Start playing'" @click="requestGame('start')" />
      <Button v-if="gameStatus?.running" icon="i-solar:stop-bold-duotone" label="Stop" @click="requestGame('stop')" />
    </div>
    <p role="status" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      {{ gameStatus?.running ? `Playing: ${gameStatus.steps} moves so far.` : (gameStatus?.ended ?? 'Not playing.') }}
    </p>
    <ul v-if="gameStatus?.log?.length" :class="['flex flex-col', 'gap-1', 'text-xs', 'text-neutral-500 dark:text-neutral-400']">
      <li v-for="(line, index) in gameStatus.log.slice().reverse()" :key="index">
        {{ line }}
      </li>
    </ul>
  </div>
  <p v-else :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
    Dahlia plays Dark War: Survival in the desktop app on a PC.
  </p>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: 'Dark War: Survival'
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
