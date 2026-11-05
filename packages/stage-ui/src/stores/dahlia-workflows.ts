// Dahlia: the owner's ticket work, which her server runs (the Avatar hub's Gateway/Workflows.cs, src/Dahlia.Workflows):
// she reads the ticket mail in Outlook and the tickets in ConnectWise through the desktop app's Chrome, pulls the
// Rapid7 investigation and drafts the reply each type of ticket gets. Settings > Modules > Tickets shows the drafts
// to approve, the ticket types she was taught, and the settings (never the Rapid7 keys, which stay on her server).
// Any app can approve; only the desktop app opens the browser to sign in (it registers that here). The owner only,
// after a voice check. This file is Dahlia's (AIRI has no such file).

import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { SERVER_URL } from '../libs/server'
import { dahliaHeaders, useDahliaAuth } from './dahlia-auth'

const WORKFLOWS_PATH = '/api/v1/dahlia/workflows'

export type DahliaNoteKind = 'discussion' | 'internal' | 'resolution'
export type DahliaDraftStatus = 'pending' | 'posted' | 'practiced' | 'rejected' | 'failed'

export interface DahliaTicketDraft {
  id: string
  created: string
  finished?: string | null
  ticket: string
  ticketUrl: string
  subject: string
  type: string
  note: DahliaNoteKind
  emailContact: boolean
  text: string
  investigationTitle: string
  remarks: string[]
  status: DahliaDraftStatus
  outcome: string
  screenshot: string
  posting: boolean
}

export interface DahliaTicketType {
  name: string
  description: string
  match: string[]
  assessment: boolean
  note: DahliaNoteKind
  emailContact: boolean
  autoSend: boolean
  response: string
}

export interface DahliaWorkflowSettings {
  enabled: boolean
  pollMinutes: number
  headless: boolean
  folder: string
  fromContains: string
  subjectPattern: string
  unreadOnly: boolean
  ticketUrl: string
  dryRun: boolean
  /** The Rapid7 organizations with a key on her server: names only. */
  organizations: string[]
}

export interface DahliaWorkflowState {
  connected: boolean
  busy: boolean
  lastScan?: string | null
  lastProblem: string
  problems: string[]
  settings: DahliaWorkflowSettings
  signIn: { urls: string[], browser: { channel?: string, headless?: boolean } }
  drafts: DahliaTicketDraft[]
  types: DahliaTicketType[]
}

export const DAHLIA_TICKET_PLACEHOLDERS = ['contact', 'contact_first', 'ticket', 'subject', 'assessment', 'investigation_title', 'investigation_priority', 'investigation_link', 'organization', 'type']

type SignIn = (urls: string[], browser: DahliaWorkflowState['signIn']['browser']) => Promise<void>
let signInHandler: SignIn | undefined

/** The desktop app opens its Chrome window for the sign-in (src/main/dahlia-workflow-browser.ts). */
export function registerDahliaWorkflowSignIn(signIn: SignIn) {
  signInHandler = signIn
}

export function hasDahliaWorkflowBrowser() {
  return signInHandler !== undefined
}

async function workflowRequest(path: string, init: RequestInit = {}): Promise<DahliaWorkflowState> {
  const response = await fetch(`${SERVER_URL}${WORKFLOWS_PATH}${path}`, {
    ...init,
    headers: dahliaHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!response.ok) {
    const message = await response.json().then((body: { error?: { message?: string } }) => body.error?.message).catch(() => undefined)
    throw new Error(response.status === 401
      ? 'Dahlia\'s server didn\'t accept the key.'
      : response.status === 403 ? (message ?? 'Pass the voice check to see your tickets.') : (message ?? `Dahlia's server answered ${response.status}.`))
  }
  return await response.json() as DahliaWorkflowState
}

export const useDahliaWorkflowsStore = defineStore('dahlia-workflows', () => {
  const auth = useDahliaAuth()
  const state = ref<DahliaWorkflowState>()
  const error = ref<string>()
  const loading = ref(false)

  const waiting = computed(() => (state.value?.drafts ?? []).filter(draft => draft.status === 'pending' || draft.status === 'failed' || draft.status === 'practiced'))
  const done = computed(() => (state.value?.drafts ?? []).filter(draft => draft.status === 'posted' || draft.status === 'rejected'))

  async function call(path: string, init: RequestInit = {}) {
    if (!auth.session.value)
      return
    loading.value = true
    error.value = undefined
    try {
      state.value = await workflowRequest(path, init)
    }
    catch (callError) {
      error.value = errorMessageFrom(callError) ?? 'Dahlia\'s server couldn\'t be reached.'
    }
    finally {
      loading.value = false
    }
  }

  const post = (path: string, body: unknown = {}) => call(path, { method: 'POST', body: JSON.stringify(body) })

  async function signIn() {
    if (!signInHandler || !state.value)
      return
    error.value = undefined
    try {
      await signInHandler(state.value.signIn.urls, state.value.signIn.browser)
    }
    catch (signInError) {
      error.value = errorMessageFrom(signInError) ?? 'The browser didn\'t open.'
    }
  }

  /** A screenshot of a ticket after its note, as a picture the page can show (it needs the key). */
  async function screenshot(name: string) {
    const response = await fetch(`${SERVER_URL}${WORKFLOWS_PATH}/screenshots/${encodeURIComponent(name)}`, { headers: dahliaHeaders() })
    if (!response.ok)
      throw new Error(`The screenshot couldn't be loaded (${response.status}).`)
    return URL.createObjectURL(await response.blob())
  }

  return {
    state: computed(() => state.value),
    waiting,
    done,
    error: computed(() => error.value),
    loading: computed(() => loading.value),
    load: () => call(''),
    scan: () => post('/scan'),
    reload: () => post('/reload'),
    saveSettings: (settings: Partial<DahliaWorkflowSettings>) => post('/settings', settings),
    approve: (draft: DahliaTicketDraft, text: string, note: DahliaNoteKind, emailContact: boolean) => post(`/drafts/${encodeURIComponent(draft.id)}/approve`, { text, note, emailContact }),
    reject: (draft: DahliaTicketDraft) => post(`/drafts/${encodeURIComponent(draft.id)}/reject`),
    retype: (draft: DahliaTicketDraft, type: string) => post(`/drafts/${encodeURIComponent(draft.id)}/retype`, { type }),
    teach: (type: DahliaTicketType, original = '') => post('/types', { ...type, original }),
    forget: (type: DahliaTicketType) => call(`/types/${encodeURIComponent(type.name)}`, { method: 'DELETE' }),
    signIn,
    screenshot,
  }
})
