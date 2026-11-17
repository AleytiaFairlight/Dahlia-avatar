import en from '@proj-airi/i18n/locales/en'

import { toStoredVoiceprint } from '@proj-airi/stage-ui/libs/voice/voiceprint'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import VoiceprintPage from './voiceprint.vue'

import 'virtual:uno.css'

// The VAD and the voiceprint model are model runtimes. The fake VAD scores every window as speech.
vi.mock('@proj-airi/stage-ui/workers/vad/silero-vad', () => ({
  SileroVad: class {
    async score() { return 0.9 }
    async close() {}
  },
}))
vi.mock('@proj-airi/stage-ui/libs/voice/speaker-model', () => ({
  computeVoiceprint: vi.fn(async (speech: Float32Array, sampleRate: number) => ({ embedding: new Float32Array([1, 0]), seconds: speech.length / sampleRate })),
}))

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanup()
  cleanups.splice(0).forEach(stop => stop())
  localStorage.clear()
})

function renderPage() {
  const pinia = createPinia()
  cleanups.push(() => disposePinia(pinia))
  return render(VoiceprintPage, {
    global: {
      plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false })],
    },
  })
}

describe('voiceprint settings', () => {
  it('turns on speaker recognition when a usable voiceprint exists', async () => {
    localStorage.setItem('settings/voice/voiceprint', JSON.stringify(toStoredVoiceprint({ embedding: new Float32Array([1, 0]), seconds: 8 }, Date.now())))
    const screen = renderPage()
    const toggle = screen.getByRole('switch')

    await expect.element(toggle).toBeEnabled()
    await expect.element(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()

    await expect.element(toggle).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => localStorage.getItem('settings/hearing/speaker-recognition-enabled')).toBe('true')
  })

  it('keeps speaker recognition unavailable until the user enrolls', async () => {
    const screen = renderPage()

    await expect.element(screen.getByRole('switch')).toBeDisabled()
    await expect.element(screen.getByText('Enroll your voice to turn on speaker recognition.')).toBeVisible()
  })
})
