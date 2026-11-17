<script setup lang="ts">
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { PageHeader } from '@proj-airi/stage-ui/components'
import { useSettingsSearchReveal } from '@proj-airi/stage-ui/composables/use-settings-search'
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView, useRoute } from 'vue-router'

import WindowTitleBar from '../components/Window/TitleBar.vue'

import { fullscreenPanelKey } from '../components/fullscreen/panel'
import { useRestoreScroll } from '../composables/use-restore-scroll'

const route = useRoute()
const { t } = useI18n()
const scrollContainer = ref<HTMLElement>()
useRestoreScroll(scrollContainer)
// A search result opens its page with the setting in the query. Scroll to that row and highlight it.
// This watcher comes after the scroll restore, so it scrolls on from the restored position.
useSettingsSearchReveal(scrollContainer)
// The fullscreen panel of the main window frames settings itself, so the layout leaves out the window title bar.
const inFullscreenPanel = inject(fullscreenPanelKey, false)

const routeMeta = computed(() => route.meta as {
  titleKey?: string
  subtitleKey?: string
  title?: string
  subtitle?: string
})

// const activeSettingsTutorial = ref('default')
const routeHeaderMetadata = computed(() => {
  const { titleKey, subtitleKey, title, subtitle } = routeMeta.value
  const resolvedTitle = titleKey ? t(titleKey) : title
  const resolvedSubtitle = subtitleKey ? t(subtitleKey) : subtitle

  if (resolvedTitle || resolvedSubtitle) {
    return {
      title: resolvedTitle,
      subtitle: resolvedSubtitle,
    }
  }

  return undefined
})
</script>

<template>
  <div h-full w-full bg="$bg-color" flex="~ col">
    <WindowTitleBar v-if="!inFullscreenPanel" :title="routeHeaderMetadata?.title ?? ''" icon="i-solar:settings-bold" />
    <div
      :style="{
        paddingTop: inFullscreenPanel ? '0px' : `44px`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
      }"

      min-h-0 flex-1
    >
      <div ref="scrollContainer" relative h-full w-full overflow-y-auto scrollbar-none>
        <div flex="~ col" mx-auto h-full max-w-screen-xl>
          <PageHeader
            :title="routeHeaderMetadata?.title ?? ''"
            :subtitle="routeHeaderMetadata?.subtitle ?? ''"
            :disable-back-button="isStageTamagotchi() && route.path === '/settings'"
            px-4
          />
          <div min-h-0 flex-1 px-4>
            <RouterView />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
