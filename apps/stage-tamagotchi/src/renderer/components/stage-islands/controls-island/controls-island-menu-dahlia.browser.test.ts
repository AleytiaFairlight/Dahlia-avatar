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

// Dahlia: the apps have no AIRI account, notification inbox or character choice, so the app menu hides those rows
// (scripts/apply_avatar_branding.sh). The menu opens in a window of its own, so it is mounted here by itself.

const authState = vi.hoisted(() => ({
  credits: { value: 0 },
  capacitorPercent: { value: null as number | null },
  capacitorRechargesAt: { value: null as string | null },
  isAuthenticated: { value: false },
  needsLogin: { value: false },
  sessionVersion: { value: 0 },
  token: { value: null as string | null },
  user: { value: null as { createdAt: Date, email: string, emailVerified: boolean, id: string, image?: string, name: string, updatedAt: Date } | null },
  userId: { value: 'local' },
  consumeLoginRequest: async () => true,
  onAuthenticated: () => () => {},
  onLogout: () => () => {},
}))

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

vi.mock('@proj-airi/stage-ui/stores/auth', async () => {
  const { reactive, ref } = await import('vue')
  authState.credits = ref(0)
  authState.capacitorPercent = ref(null)
  authState.capacitorRechargesAt = ref(null)
  authState.isAuthenticated = ref(false)
  authState.needsLogin = ref(false)
  authState.sessionVersion = ref(0)
  authState.token = ref(null)
  authState.user = ref(null)
  authState.userId = ref('local')

  // Pinia unwraps store refs. The inbox store reads `auth.token`, not `auth.token.value`.
  const store = reactive(authState)
  return { useAuthStore: () => store }
})

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

function mountMenu() {
  const Host = defineComponent({
    setup: () => () => h(ControlsIslandMenu, { open: true, side: 'right', align: 'end', signingIn: false }, {
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

const hiddenRows = ['controls-island-sign-in', 'controls-island-account', 'controls-island-subscription', 'controls-island-notifications', 'controls-island-character']

beforeEach(async () => {
  localStorage.clear()
  await page.viewport(900, 700)
  // Cloud is the HTTP boundary of the notifications.
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const request = input instanceof Request ? input : new Request(input)
    if (new URL(request.url).pathname === '/v1/inbox/unread-count')
      return Promise.resolve(Response.json({ unread: 3 }))
    return Promise.resolve(Response.json({}))
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  authState.isAuthenticated.value = false
  authState.token.value = null
  authState.user.value = null
  localStorage.clear()
})

describe('controls Island menu in Dahlia', () => {
  it('shows no sign-in, account, subscription, notifications or character rows', async () => {
    mountMenu()

    await expect.element(page.getByTestId('controls-island-settings')).toBeVisible()
    await expect.element(page.getByTestId('controls-island-character-voice')).toBeVisible()
    for (const testId of hiddenRows)
      expect(document.querySelector(`[data-testid="${testId}"]`)).toBeNull()
  })

  it('shows none of them either while an account is signed in', async () => {
    authState.token.value = 'user-token'
    authState.user.value = { id: 'user-1', name: 'Dahlia User', email: 'user@example.com', emailVerified: true, createdAt: new Date(), updatedAt: new Date() }
    authState.isAuthenticated.value = true
    mountMenu()

    await expect.element(page.getByTestId('controls-island-settings')).toBeVisible()
    for (const testId of hiddenRows)
      expect(document.querySelector(`[data-testid="${testId}"]`)).toBeNull()
  })
})
