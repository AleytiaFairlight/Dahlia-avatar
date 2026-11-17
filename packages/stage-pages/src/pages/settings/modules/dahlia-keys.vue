<script setup lang="ts">
// Dahlia: Settings > Modules > Keys, the owner's people (DahliaBot's /api/v1/dahlia/users). Each has a key of their own
// for Dahlia's apps, with their own chats, memories and voice print. Only the owner has the card (stage-ui
// composables/use-modules-list.ts) and sees the people here, after the voice check. This file is Dahlia's (AIRI has
// no such file); scripts/apply_avatar_branding.sh lists it among the modules.
import { errorMessageFrom } from '@moeru/std'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { dahliaHeaders, useDahliaAuth } from '@proj-airi/stage-ui/stores/dahlia-auth'
import { Button, FieldInput } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'

const auth = useDahliaAuth()
const isOwner = computed(() => auth.me.value?.owner === true)

interface Person { id: string, name: string, owner: boolean, voicePrint: boolean, created: string }
const people = ref<Person[]>([])
const others = computed(() => people.value.filter(person => !person.owner))
const peopleError = ref<string>()
const newPersonName = ref('')
const shownKey = ref<{ name: string, token: string }>()

async function usersRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SERVER_URL}/api/v1/dahlia/users${path}`, {
    ...init,
    headers: dahliaHeaders({ 'Content-Type': 'application/json' }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined
    throw new Error(body?.error?.message ?? `Dahlia's server answered ${response.status}.`)
  }
  return response
}

async function loadPeople() {
  if (!isOwner.value || !auth.session.value)
    return
  peopleError.value = undefined
  try {
    people.value = (await (await usersRequest('')).json() as { users: Person[] }).users
  }
  catch (error) {
    peopleError.value = errorMessageFrom(error) ?? 'The people couldn\'t be loaded.'
  }
}

async function peopleAction(action: () => Promise<unknown>) {
  peopleError.value = undefined
  try {
    await action()
  }
  catch (error) {
    peopleError.value = errorMessageFrom(error) ?? 'That didn\'t work.'
  }
  await loadPeople()
}

function addPerson() {
  const name = newPersonName.value.trim()
  if (!name)
    return
  void peopleAction(async () => {
    const created = await (await usersRequest('', { method: 'POST', body: JSON.stringify({ name }) })).json() as { name: string, token: string }
    shownKey.value = created
    newPersonName.value = ''
  })
}

function newKeyFor(person: Person) {
  // eslint-disable-next-line no-alert
  if (!window.confirm(`Make a new key for ${person.name}? Their old key stops working at once.`))
    return
  void peopleAction(async () => {
    const { token } = await (await usersRequest(`/${person.id}/token`, { method: 'POST' })).json() as { token: string }
    shownKey.value = { name: person.name, token }
  })
}

function resetVoicePrint(person: Person) {
  // eslint-disable-next-line no-alert
  if (window.confirm(`Forget ${person.name}'s voice print? They record it again with their key.`))
    void peopleAction(() => usersRequest(`/${person.id}/voice-print`, { method: 'DELETE' }))
}

function removePerson(person: Person) {
  // eslint-disable-next-line no-alert
  if (window.confirm(`Remove ${person.name}? Their key stops working; their chats and memories stay on the server.`))
    void peopleAction(() => usersRequest(`/${person.id}`, { method: 'DELETE' }))
}

async function copyShownKey() {
  if (shownKey.value)
    await navigator.clipboard.writeText(shownKey.value.token).catch(() => undefined)
}

watch([isOwner, auth.session], () => void loadPeople(), { immediate: true })
</script>

<template>
  <div :class="['flex flex-col', 'gap-4', 'pb-12']">
    <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      Give someone their own key for Dahlia's apps. Dahlia knows who she talks with: each person has their own chats and memories, records their own voice print, and can't use your notes, your PC or your Discord.
    </p>

    <p v-if="!isOwner" role="status" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      Only Dahlia's owner gives out keys.
    </p>
    <p v-else-if="!auth.session.value" role="status" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
      Pass the voice check (Settings > Dahlia) to see the keys.
    </p>
    <template v-else>
      <div :class="['flex flex-wrap items-end', 'gap-2']">
        <div :class="['min-w-60 flex-1']">
          <FieldInput v-model="newPersonName" label="Name" placeholder="Their name" />
        </div>
        <Button icon="i-solar:user-plus-bold-duotone" label="Make a key" :disabled="!newPersonName.trim()" @click="addPerson" />
      </div>
      <div v-if="shownKey" :class="['flex flex-col', 'gap-2', 'rounded-xl', 'bg-neutral-100 dark:bg-neutral-800', 'p-3']">
        <p :class="['text-sm']">
          {{ shownKey.name }}'s key. It is shown only now: give it to them privately.
        </p>
        <code :class="['break-all', 'text-xs']">{{ shownKey.token }}</code>
        <div :class="['flex flex-wrap', 'gap-2']">
          <Button icon="i-solar:copy-bold-duotone" label="Copy" @click="copyShownKey" />
          <Button label="Done" @click="shownKey = undefined" />
        </div>
      </div>
      <p v-if="peopleError" role="status" :class="['text-sm', 'text-red-600 dark:text-red-400']">
        {{ peopleError }}
      </p>
      <ul :class="['flex flex-col', 'gap-2']">
        <li v-for="person in others" :key="person.id" :class="['flex flex-wrap items-center justify-between', 'gap-2', 'text-sm']">
          <span>{{ person.name }} <span :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']">{{ person.voicePrint ? 'voice print recorded' : 'no voice print yet' }}</span></span>
          <span :class="['flex flex-wrap', 'gap-3', 'text-xs']">
            <button type="button" :class="['underline']" @click="newKeyFor(person)">New key</button>
            <button v-if="person.voicePrint" type="button" :class="['underline']" @click="resetVoicePrint(person)">Forget voice print</button>
            <button type="button" :class="['text-red-600 dark:text-red-400', 'underline']" @click="removePerson(person)">Remove</button>
          </span>
        </li>
      </ul>
      <p v-if="others.length === 0" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
        Nobody else has a key yet.
      </p>
    </template>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Keys
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
