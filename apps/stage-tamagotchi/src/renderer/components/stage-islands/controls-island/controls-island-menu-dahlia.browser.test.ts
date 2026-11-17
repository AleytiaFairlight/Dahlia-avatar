import en from '@proj-airi/i18n/locales/en'

import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import ControlsIslandMenu from './controls-island-menu.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

// Dahlia: the apps have no AIRI account, notification inbox or character choice, so the app menu has none of those
// rows. The menu opens in a window of its own, so it is mounted here by itself.

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { vi } = await import('vitest')
  return {
    getElectronEventaContext: () => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() }),
    useElectronEventaContext: () => ref({ on: vi.fn(() => vi.fn()), emit: vi.fn() }),
    useElectronEventaInvoke: () => vi.fn().mockResolvedValue(false),
    useElectronMouseInElement: () => ({ isOutside: ref(false) }),
  }
})

vi.mock('@moeru/eventa', async importOriginal => ({
  ...await importOriginal<typeof import('@moeru/eventa')>(),
  defineInvoke: () => vi.fn(),
}))

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

function mountMenu() {
  const Host = defineComponent({
    setup: () => () => h(ControlsIslandMenu, { open: true, side: 'right', align: 'end' }, {
      trigger: () => h('button', { type: 'button' }, 'More'),
    }),
  })

  return render(Host, {
    global: {
      plugins: [createPinia(), i18n],
      directives: { 'track-button': {} },
    },
  })
}

const removedRows = ['controls-island-sign-in', 'controls-island-account', 'controls-island-subscription', 'controls-island-notifications', 'controls-island-character']

beforeEach(async () => {
  localStorage.clear()
  await page.viewport(900, 700)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('controls Island menu in Dahlia', () => {
  it('has no sign-in, account, subscription, notifications or character rows', async () => {
    mountMenu()

    await expect.element(page.getByTestId('controls-island-settings')).toBeVisible()
    await expect.element(page.getByTestId('controls-island-character-voice')).toBeVisible()
    for (const testId of removedRows)
      expect(document.querySelector(`[data-testid="${testId}"]`)).toBeNull()
  })
})
