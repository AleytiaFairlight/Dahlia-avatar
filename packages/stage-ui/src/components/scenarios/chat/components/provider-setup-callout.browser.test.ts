import en from '@proj-airi/i18n/locales/en'

import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import ProviderSetupCallout from './provider-setup-callout.vue'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

async function renderCallout() {
  const onConfigure = vi.fn()
  const screen = await render(ProviderSetupCallout, {
    props: { onConfigure },
    global: {
      plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en } })],
    },
  })
  return { screen, onConfigure }
}

describe('chat provider setup callout', () => {
  it('opens the key setup when no provider is ready', async () => {
    const { screen, onConfigure } = await renderCallout()

    await expect.element(screen.getByText('Chat provider isn\'t configured')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sign in' }).query()).toBeNull()
    await screen.getByRole('button', { name: 'Open provider settings' }).click()

    expect(onConfigure).toHaveBeenCalledTimes(1)
  })
})
