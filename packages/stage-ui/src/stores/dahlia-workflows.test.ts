import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, isProxy } from 'vue'

import { registerDahliaWorkflowSignIn, useDahliaWorkflowsStore } from './dahlia-workflows'

vi.mock('./dahlia-auth', () => ({
  dahliaHeaders: (extra: Record<string, string> = {}) => ({ Authorization: 'Bearer session', ...extra }),
  useDahliaAuth: () => ({ session: computed(() => 'session') }),
}))

const STATE = {
  connected: true,
  busy: false,
  lastScan: null,
  lastProblem: '',
  problems: [],
  settings: { enabled: true, pollMinutes: 5, headless: false, folder: 'Inbox', fromContains: '', subjectPattern: '', unreadOnly: true, ticketUrl: '', dryRun: true, organizations: [] },
  signIn: { urls: ['https://outlook.office.com/mail/', 'https://cw.example.com/'], browser: { channel: 'chrome', headless: false } },
  drafts: [],
  types: [],
}

describe('dahlia workflows store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(STATE), { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hands Sign in plain values, which the desktop app\'s IPC can clone', async () => {
    const signIn = vi.fn(async (_urls: string[], _browser: { channel?: string, headless?: boolean }) => {})
    registerDahliaWorkflowSignIn(signIn)
    const store = useDahliaWorkflowsStore()
    await store.load()

    await store.signIn()

    expect(store.error).toBeUndefined()
    const [urls, browser] = signIn.mock.calls[0]
    expect(isProxy(urls)).toBe(false)
    expect(isProxy(browser)).toBe(false)
    // What Electron's ipcRenderer.invoke does with its arguments: a reactive proxy throws "could not be cloned".
    expect(structuredClone({ urls, browser })).toEqual({ urls: STATE.signIn.urls, browser: STATE.signIn.browser })
  })

  it('says why the server refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Only the owner\'s tickets are here.' } }), { status: 403 })))
    const store = useDahliaWorkflowsStore()

    await store.load()

    expect(store.error).toBe('Only the owner\'s tickets are here.')
  })
})
