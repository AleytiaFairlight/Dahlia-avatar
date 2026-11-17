import en from '@proj-airi/i18n/locales/en'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import StageAvatarModelMissing from './stage-avatar-model-missing.vue'

afterEach(() => {
  cleanup()
})

describe('stage avatar model missing', () => {
  const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false })

  // Dahlia: her VRM is built in and can't be changed in the app, so the overlay only says why the Stage is empty.
  it('says that no model is selected', async () => {
    const screen = render(StageAvatarModelMissing, {
      props: { reason: 'missing' },
      global: { plugins: [i18n()] },
    })

    await expect.element(screen.getByText('No model selected')).toBeVisible()
    expect(document.querySelector('button')).toBeNull()
  })

  it('says that this device cannot load the model of the card', async () => {
    const screen = render(StageAvatarModelMissing, {
      props: { reason: 'unavailable' },
      global: { plugins: [i18n()] },
    })

    await expect.element(screen.getByText('This model is not on this device')).toBeVisible()
  })
})
