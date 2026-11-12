// Dahlia: speaking first on this PC. Once a minute the main window checks whether this is a moment to ask her
// (stage-ui libs/dahlia-proactive.ts: the hours, the gap, whether the person is there, whether the two are
// talking); when it is, she gets a notification on the app's own path for things that happen to her (the one an
// avatar touch uses), and answers it or stays quiet. dahlia-screen-watch.ts starts it. This file is Dahlia's.

import type { DahliaPcSample } from '@proj-airi/stage-ui/libs/dahlia-pc-awareness'

import { DAHLIA_PROACTIVE_KEY, dahliaProactiveHold, dahliaProactiveNotice, readDahliaProactiveSettings } from '@proj-airi/stage-ui/libs/dahlia-proactive'
import { useCharacterOrchestratorStore } from '@proj-airi/stage-ui/stores/character/orchestrator'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useVoiceStore } from '@proj-airi/stage-ui/stores/voice'

const CHECK_MS = 60_000
/** The last state, for Settings > Dahlia: {hold, askedAt}. */
export const DAHLIA_PROACTIVE_STATUS_KEY = 'dahlia/speak-first-status'

let started = false

export function startDahliaProactive() {
  if (started)
    return
  started = true
  const startedAt = Date.now()
  const asked: number[] = []
  let lastTurnAt: number | undefined
  let lastAskedAt: number | undefined

  const chat = useChatStore()
  // What either of them says moves the quiet time on. Her own first words count too: she doesn't follow up at once.
  chat.onBeforeSend(async () => {
    lastTurnAt = Date.now()
  })
  chat.onAssistantResponseEnd(async () => {
    lastTurnAt = Date.now()
  })

  setInterval(() => void check().catch(error => console.warn('Dahlia: speaking first failed:', error)), CHECK_MS)

  async function check() {
    const settings = readDahliaProactiveSettings(localStorage.getItem(DAHLIA_PROACTIVE_KEY))
    const now = Date.now()
    const sample = settings.enabled
      ? await (window.electron.ipcRenderer.invoke('dahlia:pc-state') as Promise<DahliaPcSample>).catch(() => undefined)
      : undefined
    const busy = chat.sending || useVoiceStore().activeTurns.length > 0
    const hold = dahliaProactiveHold(settings, { now, startedAt, lastTurnAt, lastAskedAt, asked, idleSeconds: sample?.idleSeconds, busy })
    localStorage.setItem(DAHLIA_PROACTIVE_STATUS_KEY, JSON.stringify({ hold: hold ?? 'asked', at: now, askedAt: hold ? lastAskedAt : now }))
    if (hold)
      return

    lastAskedAt = now
    asked.push(now)
    while (asked.length > 100)
      asked.shift()
    const id = `dahlia-speak-first:${now}`
    await useCharacterOrchestratorStore().handleSparkNotify({
      type: 'spark:notify',
      source: 'dahlia:speak-first',
      data: { id, eventId: id, kind: 'ping', urgency: 'soon', ...dahliaProactiveNotice({ now, lastTurnAt }), payload: {}, destinations: ['character'] },
    })
  }
}
