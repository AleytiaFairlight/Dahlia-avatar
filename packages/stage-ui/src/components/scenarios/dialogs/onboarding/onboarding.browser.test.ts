import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { App } from 'vue'

import type { DevicePermission, DevicePermissionStatus } from '../../../../stores/device-permissions'
import type { OnboardingStepLaterHandler, OnboardingStepNextHandler } from './types'

import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp, defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import OnboardingDialog from './onboarding.vue'
import StepProviderConfiguration from './step-provider-configuration.vue'

import { useDevicePermissionsStore } from '../../../../stores/device-permissions'
import { sharedOnboardingSteps, useOnboardingStore } from '../../../../stores/onboarding'
import { useProviderConfigStore } from '../../../../stores/providers/config'
import { useProviderStore } from '../../../../stores/providers/provider'

// Dahlia: stand-in providers for the tests; the apps register only Dahlia's.
import '../../../../libs/providers/providers/test-providers'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const syncedContexts: Array<{
  app: App
  pinia: ReturnType<typeof createPinia>
  runtime: SyncedPiniaRuntime
}> = []

function createSyncedContext(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({
    callTimeout: 1000,
    leadership,
    namespace,
  })
  pinia.use(runtime.plugin)
  let providerStore: ReturnType<typeof useProviderStore> | undefined
  let providerConfigStore: ReturnType<typeof useProviderConfigStore> | undefined
  const app = createApp({
    setup() {
      providerStore = useProviderStore()
      providerConfigStore = useProviderConfigStore()
      return () => null
    },
  })
  app
    .use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
    .use(pinia)
    .mount(document.createElement('div'))
  if (!providerStore || !providerConfigStore)
    throw new Error('Provider stores did not initialize')

  syncedContexts.push({ app, pinia, runtime })
  return { pinia, providerConfigStore, providerStore, runtime }
}

function createTestI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en } })
}

beforeEach(() => {
  localStorage.clear()
  // The validators, model listing, and the ping check all run against the
  // configured gateway. One stub answers every OpenAI-compatible endpoint.
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/chat/completions')) {
      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'grok-4.6',
        choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    }
    return Response.json({ object: 'list', data: [{ id: 'grok-4.6' }, { id: 'grok-4.5' }] })
  }))
})

afterEach(() => {
  for (const context of syncedContexts.splice(0)) {
    context.app.unmount()
    context.runtime.dispose()
    disposePinia(context.pinia)
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  localStorage.clear()
})

// ROOT CAUSE:
//
// The configuration step kept its form in component-local refs and reset them
// in initializeForm() on every mount. Each step change remounts the step, so
// going back from model selection wiped the typed API key and restored the
// default base URL.
it('rehydrates the configuration form from the saved provider configuration', async () => {
  const context = createSyncedContext(`onboarding-step:${crypto.randomUUID()}`, 'leader-only')
  await context.providerConfigStore.ensureProvider('test-chat', 'test-chat', {})
  await context.providerConfigStore.patchProviderConfig('test-chat', {
    apiKey: 'sk-saved-key',
    baseUrl: 'https://saved.example.com/v1',
  })

  await vi.waitFor(() => {
    expect(context.providerStore.allChatProvidersMetadata.some(provider => provider.id === 'test-chat')).toBe(true)
  })
  const metadata = context.providerStore.allChatProvidersMetadata.find(provider => provider.id === 'test-chat')
  if (!metadata)
    throw new Error('test-chat metadata did not initialize')

  await render(StepProviderConfiguration, {
    props: {
      selectedProviderId: 'test-chat',
      selectedProvider: metadata,
      onNext: () => {},
      onPrevious: () => {},
    },
    global: { plugins: [context.pinia, PiniaColada, createTestI18n()] },
  })

  await expect.element(page.getByPlaceholder('API Key')).toHaveValue('sk-saved-key')
  await expect.poll(() => Array.from(document.querySelectorAll('input')).some(input => input.value === 'https://saved.example.com/v1')).toBe(true)
})

/** A host step with one button for each handler that the flow gives it. */
const HostStep = defineComponent(
  (props: { onNext: OnboardingStepNextHandler, onLater?: OnboardingStepLaterHandler }) => () => h('div', [
    h('button', { onClick: () => props.onNext() }, 'Continue'),
    props.onLater ? h('button', { onClick: () => props.onLater?.() }, 'Later') : null,
  ]),
  { props: ['onNext', 'onLater'] },
)

/** Records every shared step as done, as a device that finished the first onboarding. */
function seedFinishedSharedSteps() {
  localStorage.setItem('onboarding/steps', JSON.stringify(Object.fromEntries(
    sharedOnboardingSteps.map(step => [step.id, { version: step.version, outcome: 'done', at: 0 }]),
  )))
}

function readStepRecords() {
  return JSON.parse(localStorage.getItem('onboarding/steps') ?? '{}')
}

it('shows only the host step whose version increased, and records it through the leader at the finish', async () => {
  seedFinishedSharedSteps()
  localStorage.setItem('onboarding/steps', JSON.stringify({ ...readStepRecords(), 'host-notice': { version: 1, outcome: 'done', at: 0 } }))
  // The desktop onboarding window is a follower. The leader must persist the records.
  const namespace = `onboarding-versions:${crypto.randomUUID()}`
  const leader = createSyncedContext(namespace, 'leader-only')
  await expect.poll(() => leader.runtime.isLeader()).toBe(true)
  // The main window creates the onboarding store at startup, so the leader can answer the follower.
  useOnboardingStore(leader.pinia)
  const follower = createSyncedContext(namespace, 'follower-only')
  await expect.poll(() => follower.runtime.getLeaderId()).toBe(leader.runtime.participantId)
  const configured = vi.fn()

  const screen = await render(OnboardingDialog, {
    props: { extraSteps: [{ id: 'host-notice', version: 2, component: HostStep }], onConfigured: configured },
    global: { plugins: [follower.pinia, PiniaColada, createTestI18n()] },
  })

  await expect.element(screen.getByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Later' })).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Continue' }).click()

  await vi.waitFor(() => expect(configured).toHaveBeenCalled())
  expect(readStepRecords()['host-notice']).toMatchObject({ version: 2, outcome: 'done' })
})

it('keeps the later record of an optional step that the user postponed', async () => {
  seedFinishedSharedSteps()
  const context = createSyncedContext(`onboarding-later:${crypto.randomUUID()}`, 'leader-only')
  await expect.poll(() => context.runtime.isLeader()).toBe(true)
  const configured = vi.fn()

  const screen = await render(OnboardingDialog, {
    props: { extraSteps: [{ id: 'host-permissions', version: 2, optional: true, component: HostStep }], onConfigured: configured },
    global: { plugins: [context.pinia, PiniaColada, createTestI18n()] },
  })

  await screen.getByRole('button', { name: 'Later' }).click()

  await vi.waitFor(() => expect(configured).toHaveBeenCalled())
  expect(readStepRecords()['host-permissions']).toMatchObject({ version: 2, outcome: 'later' })
})

/**
 * Renders the flow for a user who finished provider setup, on a host with one permission. Without `permission`, it is
 * a notifications permission. Its `request` grants it, as a user who allows the system prompt.
 */
async function renderPermissionsFlow(permission?: DevicePermission) {
  localStorage.setItem('onboarding/steps', JSON.stringify(Object.fromEntries(
    sharedOnboardingSteps.filter(step => step.scope === 'provider-setup').map(step => [step.id, { version: step.version, outcome: 'done', at: 0 }]),
  )))
  const context = createSyncedContext(`onboarding-permissions:${crypto.randomUUID()}`, 'leader-only')
  await expect.poll(() => context.runtime.isLeader()).toBe(true)
  let status: DevicePermissionStatus = 'not-determined'
  useDevicePermissionsStore(context.pinia).register([permission ?? {
    id: 'notifications',
    kind: 'notifications',
    titleKey: 'settings.dialogs.onboarding.permissions.notificationsTitle',
    descriptionKey: 'settings.dialogs.onboarding.permissions.notificationsDescription',
    check: async () => status,
    request: async () => {
      status = 'granted'
    },
  }])
  const configured = vi.fn()
  const screen = await render(OnboardingDialog, {
    props: { onConfigured: configured },
    global: { plugins: [context.pinia, PiniaColada, createTestI18n()] },
  })
  return { screen, configured }
}

it('shows only the permissions step to a user who finished provider setup, and records Set up later', async () => {
  const { screen, configured } = await renderPermissionsFlow()

  await expect.element(screen.getByRole('heading', { name: 'Get reminders from your character' })).toBeInTheDocument()
  await screen.getByRole('button', { name: 'Set up later' }).click()

  await vi.waitFor(() => expect(configured).toHaveBeenCalled())
  expect(readStepRecords().permissions).toMatchObject({ version: 1, outcome: 'later' })
})

it('shows a skipped permission in the summary, and records the step as done', async () => {
  const { screen, configured } = await renderPermissionsFlow()

  await screen.getByRole('button', { name: 'Skip' }).click()
  await expect.element(screen.getByRole('heading', { name: 'Almost there' })).toBeInTheDocument()
  await expect.element(screen.getByText('Skipped. You do not get reminders.')).toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Notifications, Skipped' })).toBeInTheDocument()
  await screen.getByRole('button', { name: 'Done' }).click()

  await vi.waitFor(() => expect(configured).toHaveBeenCalled())
  expect(readStepRecords().permissions).toMatchObject({ version: 1, outcome: 'done' })
})

it('continues after the user allows a permission, and shows it as granted in the summary', async () => {
  const { screen } = await renderPermissionsFlow()

  await screen.getByRole('button', { name: 'Allow' }).click()
  await screen.getByRole('button', { name: 'Continue' }).click()

  await expect.element(screen.getByRole('heading', { name: 'You\'re all set' })).toBeInTheDocument()
  await expect.element(screen.getByRole('img', { name: 'Granted' })).toBeInTheDocument()
  // The steps are buttons, so the user can go back to a permission from the summary.
  await screen.getByRole('button', { name: 'Notifications, Allowed' }).click()
  await expect.element(screen.getByRole('heading', { name: 'Get reminders from your character' })).toBeInTheDocument()
})

it('goes back to the previous permission page from the summary', async () => {
  const { screen } = await renderPermissionsFlow()

  await screen.getByRole('button', { name: 'Skip' }).click()
  await expect.element(screen.getByRole('heading', { name: 'Almost there' })).toBeInTheDocument()
  await screen.getByRole('button', { name: 'Back' }).click()

  await expect.element(screen.getByRole('heading', { name: 'Get reminders from your character' })).toBeInTheDocument()
})

it('opens a skipped permission again from the summary', async () => {
  const { screen } = await renderPermissionsFlow()

  await screen.getByRole('button', { name: 'Skip' }).click()
  await screen.getByRole('button', { name: 'Set up Notifications' }).click()

  await expect.element(screen.getByRole('heading', { name: 'Get reminders from your character' })).toBeInTheDocument()
})

// https://github.com/moeru-ai/airi/pull/3383#discussion_r4466446388
// ROOT CAUSE:
//
// A denied web microphone offered "Open System Settings". A page cannot open the site settings,
// and the browser does not ask again, so the button did nothing.
//
// We fixed this with `deniedHintKey`. The page shows where to allow it, and the button says "Try again".
it('tells the user where to allow a denied permission when the host cannot open its settings', async () => {
  const { screen } = await renderPermissionsFlow({
    id: 'microphone',
    kind: 'microphone',
    titleKey: 'settings.dialogs.onboarding.permissions.microphoneTitle',
    descriptionKey: 'settings.dialogs.onboarding.permissions.microphoneDescription',
    deniedHintKey: 'settings.pages.modules.hearing.sections.section.input-device.blocked-description',
    check: async () => 'denied',
    request: async () => {},
  })

  await expect.element(screen.getByText('Allow the microphone for this site in the browser site settings, then try again.')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})
