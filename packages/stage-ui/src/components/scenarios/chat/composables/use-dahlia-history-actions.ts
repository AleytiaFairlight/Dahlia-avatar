import type { ChatHistoryItem } from '../../../../types/chat'

import { errorMessageFromValue } from '@proj-airi/stage-shared'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { useDahliaPictureBackground } from '../../../../composables/use-dahlia-picture-background'
import { withEditedAssistantText, withEditedUserText } from '../../../../libs/dahlia-chat-edits'
import { useChatSessionStore } from '../../../../stores/chat/session-store'

/** A message of the history that a Dahlia action works on. */
export interface DahliaHistoryActionPayload {
  message: ChatHistoryItem
  index: number
  key: string | number
}

/** The owner saved an edit of a message. `resend` asks her again with the edited message (only the owner's own). */
export interface DahliaHistoryEditPayload extends DahliaHistoryActionPayload {
  text: string
  resend: boolean
}

/** The owner turned one of her pictures into the stage background. */
export interface DahliaHistoryBackgroundPayload extends DahliaHistoryActionPayload {
  url: string
  title: string
}

/**
 * Dahlia: what the chat does when the owner edits a message, branches or trims the conversation, or turns her picture
 * into the background. Each chat view hands it its session and how it asks her again.
 *
 * Use when:
 * - A view shows `ChatHistory` with `dahlia-actions` and binds its edit, branch, trim and background events
 */
export function useDahliaHistoryActions(options: {
  sessionId: () => string
  /** Asks her again from the message at `index`, as the view's retry does. */
  retry: (index: number) => Promise<unknown>
}) {
  const chatSession = useChatSessionStore()
  const { setPictureAsBackground } = useDahliaPictureBackground()
  const { t } = useI18n()

  async function edit(payload: DahliaHistoryEditPayload) {
    const { message, index, text } = payload
    const edited = message.role === 'user'
      ? withEditedUserText(message, text)
      : message.role === 'assistant' ? withEditedAssistantText(message, text) : undefined
    if (!edited)
      return

    try {
      await chatSession.editMessage(options.sessionId(), index, edited)
    }
    catch (error) {
      toast.error(t('stage.chat.edit.failed', { error: errorMessageFromValue(error) }))
      return
    }
    if (payload.resend && message.role === 'user')
      await options.retry(index)
  }

  async function branch(payload: DahliaHistoryActionPayload) {
    try {
      const sessionId = await chatSession.forkSession({ fromSessionId: options.sessionId(), atIndex: payload.index + 1 })
      await chatSession.setActiveSession(sessionId)
    }
    catch (error) {
      toast.error(t('stage.chat.history-actions.branch-failed', { error: errorMessageFromValue(error) }))
    }
  }

  async function trim(payload: DahliaHistoryActionPayload) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('stage.chat.history-actions.trim-confirm')))
      return
    try {
      await chatSession.trimSessionAfter(options.sessionId(), payload.index)
    }
    catch (error) {
      toast.error(t('stage.chat.history-actions.trim-failed', { error: errorMessageFromValue(error) }))
    }
  }

  async function background(payload: DahliaHistoryBackgroundPayload) {
    try {
      await setPictureAsBackground(payload.url, payload.title)
      toast.success(t('stage.chat.history-actions.background-done'))
    }
    catch (error) {
      toast.error(t('stage.chat.history-actions.background-failed', { error: errorMessageFromValue(error) }))
    }
  }

  return { edit, branch, trim, background }
}
