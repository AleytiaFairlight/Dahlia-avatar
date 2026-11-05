<script setup lang="ts">
// Dahlia: Settings > Modules > Tickets, the owner's ticket work (stores/dahlia-workflows.ts). Her server reads the ticket
// mail in Outlook and the tickets in ConnectWise through the desktop app's Chrome, pulls the Rapid7 investigation and
// drafts each ticket type's reply; here the owner approves, edits or rejects the drafts, teaches the types and their
// replies, and changes the settings. The Rapid7 keys stay on her server and never show here. This file is Dahlia's
// (AIRI has no such file); scripts/apply_avatar_branding.sh lists it among the modules.
import type { DahliaNoteKind, DahliaTicketDraft, DahliaTicketType, DahliaWorkflowSettings } from '@proj-airi/stage-ui/stores/dahlia-workflows'

import { useDahliaAuth } from '@proj-airi/stage-ui/stores/dahlia-auth'
import { DAHLIA_TICKET_PLACEHOLDERS, hasDahliaWorkflowBrowser, useDahliaWorkflowsStore } from '@proj-airi/stage-ui/stores/dahlia-workflows'
import { Button, FieldCheckbox, FieldInput } from '@proj-airi/ui'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

const workflows = useDahliaWorkflowsStore()
const auth = useDahliaAuth()
const canSignIn = hasDahliaWorkflowBrowser()
const NOTE_KINDS: DahliaNoteKind[] = ['discussion', 'internal', 'resolution']

interface DraftEdit { text: string, note: DahliaNoteKind, emailContact: boolean, type: string }
const edits = reactive<Record<string, DraftEdit>>({})
const screenshots = reactive<Record<string, string>>({})

interface TypeForm { original: string, name: string, description: string, match: string, assessment: boolean, note: DahliaNoteKind, emailContact: boolean, autoSend: boolean, response: string }
function typeForm(type?: DahliaTicketType): TypeForm {
  return {
    original: type?.name ?? '',
    name: type?.name ?? '',
    description: type?.description ?? '',
    match: (type?.match ?? []).join('\n'),
    assessment: type?.assessment ?? true,
    note: type?.note ?? 'discussion',
    emailContact: type?.emailContact ?? true,
    autoSend: type?.autoSend ?? false,
    response: type?.response ?? '',
  }
}
const typeForms = reactive<Record<string, TypeForm>>({})
const newType = ref<TypeForm>(typeForm())
const settings = ref<Omit<DahliaWorkflowSettings, 'organizations'>>()

const state = computed(() => workflows.state)
const placeholders = DAHLIA_TICKET_PLACEHOLDERS.map(name => `{${name}}`).join(', ')
const lastScan = computed(() => state.value?.lastScan ? new Date(state.value.lastScan).toLocaleString() : 'not yet')

watch(state, (next) => {
  if (!next)
    return
  for (const draft of next.drafts) {
    if (!edits[draft.id])
      edits[draft.id] = { text: draft.text, note: draft.note, emailContact: draft.emailContact, type: draft.type }
    // A new type for the draft brings its new text.
    else if (edits[draft.id].type !== draft.type)
      edits[draft.id] = { text: draft.text, note: draft.note, emailContact: draft.emailContact, type: draft.type }
  }
  for (const type of next.types) {
    if (!typeForms[type.name])
      typeForms[type.name] = typeForm(type)
  }
  for (const name of Object.keys(typeForms)) {
    if (!next.types.some(type => type.name === name))
      delete typeForms[name]
  }
  if (!settings.value) {
    const { organizations: _, ...rest } = next.settings
    settings.value = { ...rest }
  }
})

function approve(draft: DahliaTicketDraft) {
  const edit = edits[draft.id]
  void workflows.approve(draft, edit.text, edit.note, edit.emailContact)
}

function retype(draft: DahliaTicketDraft) {
  void workflows.retype(draft, edits[draft.id].type)
}

function teachFrom(draft: DahliaTicketDraft) {
  newType.value = { ...typeForm(), response: edits[draft.id]?.text ?? draft.text }
  document.getElementById('dahlia-teach')?.scrollIntoView({ behavior: 'smooth' })
}

function toType(form: TypeForm): DahliaTicketType {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    match: form.match.split('\n').map(word => word.trim()).filter(Boolean),
    assessment: form.assessment,
    note: form.note,
    emailContact: form.emailContact,
    autoSend: form.autoSend,
    response: form.response,
  }
}

async function teach(form: TypeForm, isNew: boolean) {
  await workflows.teach(toType(form), form.original)
  if (isNew && !workflows.error)
    newType.value = typeForm()
  if (!isNew && form.original !== form.name.trim())
    delete typeForms[form.original]
}

async function showScreenshot(draft: DahliaTicketDraft) {
  if (!screenshots[draft.id])
    screenshots[draft.id] = await workflows.screenshot(draft.screenshot).catch(() => '')
}

function saveSettings() {
  if (settings.value)
    void workflows.saveSettings(settings.value)
}

function statusText(draft: DahliaTicketDraft) {
  if (draft.posting)
    return 'Posting…'
  return { pending: 'Waiting for you', practiced: 'Filled in (dry run)', failed: 'Posting failed', posted: 'Posted', rejected: 'Rejected' }[draft.status]
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void workflows.load()
  // The drafts change while she scans and posts.
  timer = setInterval(() => void workflows.load(), 20_000)
})
onUnmounted(() => clearInterval(timer))
watch(auth.session, () => void workflows.load())

const box = ['rounded-lg', 'border', 'border-neutral-200 dark:border-neutral-700', 'bg-white dark:bg-neutral-900/60', 'px-3 py-2', 'text-sm', 'w-full']
const card = ['flex flex-col', 'gap-3', 'rounded-xl', 'bg-neutral-50 dark:bg-neutral-800/60', 'p-4']
const muted = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
</script>

<template>
  <div :class="['flex flex-col', 'gap-4']">
    <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      Dahlia reads your ticket mail in Outlook and the tickets in ConnectWise through the desktop app's Chrome, pulls the
      Rapid7 investigation, and drafts the reply each type of ticket gets. Nothing reaches a ticket until you approve it here.
    </p>

    <p v-if="!auth.session.value" role="status" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      Pass the voice check (Settings > Dahlia) to see your tickets.
    </p>
    <p v-if="workflows.error" role="alert" :class="['text-sm', 'text-red-600 dark:text-red-400']">
      {{ workflows.error }}
    </p>

    <template v-if="state">
      <section :class="card">
        <div :class="['flex flex-wrap items-center', 'gap-2', 'text-sm']">
          <span :class="[state.connected ? 'i-solar:check-circle-bold-duotone text-green-500' : 'i-solar:danger-circle-bold-duotone text-amber-500', 'text-lg']" aria-hidden="true" />
          <span>{{ state.connected ? 'The desktop app on your PC is connected.' : 'The desktop app on your PC isn\'t connected: Dahlia scans while it runs.' }}</span>
          <span :class="muted">Last scan: {{ lastScan }}{{ state.busy ? ' · working now…' : '' }}</span>
        </div>
        <p v-for="problem in [state.lastProblem, ...state.problems].filter(Boolean)" :key="problem" role="status" :class="['rounded-lg', 'bg-amber-50 dark:bg-amber-900/30', 'px-3 py-2', 'text-sm', 'text-amber-800 dark:text-amber-200']">
          {{ problem }}
        </p>
        <p v-if="state.settings.dryRun" :class="['rounded-lg', 'bg-sky-50 dark:bg-sky-900/30', 'px-3 py-2', 'text-sm', 'text-sky-800 dark:text-sky-200']">
          Dry run is on: approving fills the note in on the ticket and takes a screenshot, without pressing Save. Turn it
          off below once the screenshots look right.
        </p>
        <div :class="['flex flex-wrap', 'gap-2']">
          <Button icon="i-solar:refresh-bold-duotone" label="Scan now" :disabled="workflows.loading || state.busy" @click="workflows.scan()" />
          <Button v-if="canSignIn" icon="i-solar:login-3-bold-duotone" label="Sign in" @click="workflows.signIn()" />
          <Button icon="i-solar:restart-bold-duotone" label="Reload" :disabled="workflows.loading" @click="workflows.reload()" />
        </div>
        <p v-if="canSignIn" :class="muted">
          Sign in opens Dahlia's Chrome with Outlook and ConnectWise: sign in to both (tick "Stay signed in") once, and
          again when she says a site wants it.
        </p>
      </section>

      <h2 :class="['text-base font-semibold']">
        Waiting for you ({{ workflows.waiting.length }})
      </h2>
      <p v-if="!workflows.waiting.length" :class="muted">
        Nothing to approve.
      </p>
      <section v-for="draft in workflows.waiting" :key="draft.id" :class="card">
        <div :class="['flex flex-col', 'gap-0.5']">
          <span :class="['text-sm font-medium']">
            Ticket <a v-if="draft.ticketUrl.startsWith('https://')" :href="draft.ticketUrl" target="_blank" rel="noopener noreferrer" :class="['underline']">#{{ draft.ticket }}</a><template v-else>#{{ draft.ticket }}</template>
            — {{ draft.subject }}
          </span>
          <span :class="muted">
            {{ draft.type || 'No type' }}{{ draft.investigationTitle ? ` · Rapid7: ${draft.investigationTitle}` : '' }} · {{ statusText(draft) }}{{ draft.outcome && draft.status !== 'pending' ? `: ${draft.outcome}` : '' }}
          </span>
        </div>
        <ul v-if="draft.remarks.length" :class="['list-disc', 'pl-5', 'text-sm', 'text-amber-700 dark:text-amber-300']">
          <li v-for="remark in draft.remarks" :key="remark">
            {{ remark }}
          </li>
        </ul>
        <template v-if="edits[draft.id]">
          <textarea v-model="edits[draft.id].text" rows="10" :class="[...box, 'font-mono']" aria-label="The reply" />
          <div :class="['flex flex-wrap items-center', 'gap-3', 'text-sm']">
            <label :class="['flex items-center', 'gap-2']">Note
              <select v-model="edits[draft.id].note" :class="box">
                <option v-for="kind in NOTE_KINDS" :key="kind" :value="kind">{{ kind }}</option>
              </select>
            </label>
            <label :class="['flex items-center', 'gap-2']">
              <input v-model="edits[draft.id].emailContact" type="checkbox"> Email it to the contact
            </label>
            <label v-if="state.types.length" :class="['flex items-center', 'gap-2']">Type
              <select v-model="edits[draft.id].type" :class="box">
                <option v-for="type in state.types" :key="type.name" :value="type.name">{{ type.name }}</option>
              </select>
            </label>
            <Button v-if="state.types.length && edits[draft.id].type !== draft.type" size="sm" label="Use this type's reply" @click="retype(draft)" />
          </div>
          <div :class="['flex flex-wrap', 'gap-2']">
            <Button variant="primary" icon="i-solar:check-read-bold-duotone" :label="state.settings.dryRun ? 'Approve (fill in only)' : 'Approve and post'" :disabled="draft.posting || !edits[draft.id].text.trim()" @click="approve(draft)" />
            <Button variant="secondary" icon="i-solar:close-circle-bold-duotone" label="Reject" :disabled="draft.posting" @click="workflows.reject(draft)" />
            <Button v-if="draft.screenshot" variant="secondary" icon="i-solar:gallery-bold-duotone" label="Screenshot" @click="showScreenshot(draft)" />
            <Button variant="secondary" icon="i-solar:book-bookmark-bold-duotone" label="Teach a type from this" @click="teachFrom(draft)" />
          </div>
          <img v-if="screenshots[draft.id]" :src="screenshots[draft.id]" alt="The ticket after Dahlia filled in the note" :class="['rounded-lg', 'border', 'border-neutral-200 dark:border-neutral-700']">
        </template>
      </section>

      <template v-if="workflows.done.length">
        <h2 :class="['text-base font-semibold']">
          Done
        </h2>
        <ul :class="['flex flex-col', 'gap-1', 'text-sm']">
          <li v-for="draft in workflows.done" :key="draft.id">
            #{{ draft.ticket }} · {{ draft.type || 'no type' }} · {{ statusText(draft) }}<span v-if="draft.outcome" :class="muted"> — {{ draft.outcome }}</span>
          </li>
        </ul>
      </template>

      <h2 :class="['text-base font-semibold']">
        Ticket types
      </h2>
      <p :class="muted">
        The same reply every time for a type of ticket. Placeholders: {{ placeholders }}.
        Match words: one per line, /pattern/ for a regex; when none fits, Dahlia picks the type from its description.
      </p>
      <details v-for="(form, name) in typeForms" :key="name" :class="card">
        <summary :class="['cursor-pointer', 'text-sm font-medium']">
          {{ name }}<span v-if="form.autoSend" :class="muted"> · posts without asking</span>
        </summary>
        <FieldInput v-model="form.name" label="Name" />
        <FieldInput v-model="form.description" label="What these tickets are" />
        <label :class="['flex flex-col', 'gap-1', 'text-sm']">Match words, one per line
          <textarea v-model="form.match" rows="3" :class="box" />
        </label>
        <label :class="['flex flex-col', 'gap-1', 'text-sm']">Reply
          <textarea v-model="form.response" rows="8" :class="[...box, 'font-mono']" />
        </label>
        <div :class="['flex flex-wrap items-center', 'gap-3', 'text-sm']">
          <label :class="['flex items-center', 'gap-2']">Note
            <select v-model="form.note" :class="box">
              <option v-for="kind in NOTE_KINDS" :key="kind" :value="kind">{{ kind }}</option>
            </select>
          </label>
          <label :class="['flex items-center', 'gap-2']"><input v-model="form.assessment" type="checkbox"> Rapid7 assessment</label>
          <label :class="['flex items-center', 'gap-2']"><input v-model="form.emailContact" type="checkbox"> Email the contact</label>
          <label :class="['flex items-center', 'gap-2']"><input v-model="form.autoSend" type="checkbox"> Post without asking me</label>
        </div>
        <div :class="['flex flex-wrap', 'gap-2']">
          <Button label="Save" :disabled="!form.name.trim() || !form.response.trim()" @click="teach(form, false)" />
          <Button variant="secondary" label="Forget" @click="workflows.forget(toType(form))" />
        </div>
      </details>

      <section id="dahlia-teach" :class="card">
        <h3 :class="['text-sm font-medium']">
          Teach a new type
        </h3>
        <FieldInput v-model="newType.name" label="Name" placeholder="Phishing report" />
        <FieldInput v-model="newType.description" label="What these tickets are" placeholder="A user reported a suspicious email" />
        <label :class="['flex flex-col', 'gap-1', 'text-sm']">Match words, one per line
          <textarea v-model="newType.match" rows="3" :class="box" />
        </label>
        <label :class="['flex flex-col', 'gap-1', 'text-sm']">Reply
          <textarea v-model="newType.response" rows="8" :class="[...box, 'font-mono']" placeholder="Hi {contact_first},&#10;&#10;{assessment}" />
        </label>
        <div :class="['flex flex-wrap items-center', 'gap-3', 'text-sm']">
          <label :class="['flex items-center', 'gap-2']">Note
            <select v-model="newType.note" :class="box">
              <option v-for="kind in NOTE_KINDS" :key="kind" :value="kind">{{ kind }}</option>
            </select>
          </label>
          <label :class="['flex items-center', 'gap-2']"><input v-model="newType.assessment" type="checkbox"> Rapid7 assessment</label>
          <label :class="['flex items-center', 'gap-2']"><input v-model="newType.emailContact" type="checkbox"> Email the contact</label>
          <label :class="['flex items-center', 'gap-2']"><input v-model="newType.autoSend" type="checkbox"> Post without asking me</label>
        </div>
        <div>
          <Button icon="i-solar:book-bookmark-bold-duotone" label="Teach Dahlia this type" :disabled="!newType.name.trim() || !newType.response.trim()" @click="teach(newType, true)" />
        </div>
      </section>

      <h2 :class="['text-base font-semibold']">
        Settings
      </h2>
      <section v-if="settings" :class="card">
        <FieldInput v-model="settings.ticketUrl" label="ConnectWise ticket link" description="A ticket link from your ConnectWise Manage, with {ticket} where the ticket number goes." placeholder="https://na.myconnectwise.net/...service_recid={ticket}&companyName=..." />
        <FieldInput v-model="settings.folder" label="Outlook folder" description="Inbox, or the folder an inbox rule moves the ticket mail to." />
        <FieldInput v-model="settings.fromContains" label="Only mail from" description="A name or address the ticket mail shows. Empty: any sender." />
        <FieldInput v-model="settings.subjectPattern" label="Ticket number pattern" description="A regex; its first ( ) group is the ticket number." />
        <label :class="['flex items-center', 'gap-2', 'text-sm']">Scan every
          <input v-model.number="settings.pollMinutes" type="number" min="1" max="240" :class="[...box, 'w-24']"> minutes
        </label>
        <FieldCheckbox v-model="settings.enabled" label="Scan for tickets" />
        <FieldCheckbox v-model="settings.unreadOnly" label="Only unread mail" description="A ticket mail you opened yourself is yours." />
        <FieldCheckbox v-model="settings.dryRun" label="Dry run" description="Approving fills the note in and takes a screenshot without pressing Save." />
        <FieldCheckbox v-model="settings.headless" label="Hide Dahlia's Chrome" description="Applies the next time it starts." />
        <p :class="muted">
          Rapid7 organizations with a key on Dahlia's server: {{ state.settings.organizations.join(', ') || 'none' }}. The keys
          are in data/Dahlia.Workflows on the server and never come to this app.
        </p>
        <div>
          <Button icon="i-solar:diskette-bold-duotone" label="Save settings" :disabled="workflows.loading" @click="saveSettings()" />
        </div>
      </section>
    </template>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Tickets
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
