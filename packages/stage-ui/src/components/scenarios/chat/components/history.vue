<script setup lang="ts">
import type { VirtualizerHandle } from 'virtua/vue'

import type { ChatToolCallRerunEvent, ToolCallRerunRequest } from '../../../../stores/tool-call-rerun'
import type { ChatHistoryItem, StreamingAssistantMessage } from '../../../../types/chat'
import type { DahliaHistoryActionPayload, DahliaHistoryBackgroundPayload, DahliaHistoryEditPayload } from '../composables/use-dahlia-history-actions'
import type { ChatHistoryReplyPayload } from '../reply'
import type { ChatToolCallRendererRegistry, ChatToolCallWidgetRegistry } from './tool-call-renderer'

import { useNow } from '@vueuse/core'
import { Virtualizer } from 'virtua/vue'
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatAssistantItem from './assistant-item.vue'
import ChatHistoryScrollContainer from './chat-history-scroll-container.vue'
import ChatErrorItem from './error-item.vue'
import ChatHistoryMessageFrame from './history-message-frame.vue'
import ChatHistoryTimeSeparator from './history-time-separator.vue'
import ChatNoticeItem from './notice-item.vue'
import ChatUserItem from './user-item.vue'

import { dahliaPicturesIn } from '../../../../libs/dahlia-chat-edits'
import { useChatHistoryScroll } from '../composables/use-chat-history-scroll'
import { useChatHistoryTopFade } from '../composables/use-chat-history-top-fade'
import { useVirtualizerBottomAlignment, useVirtualizerScroll } from '../composables/use-virtualizer-scroll'
import { getChatHistoryItemCopyText, getChatHistoryItemKey } from '../utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  messages: ChatHistoryItem[]
  streamingMessage?: StreamingAssistantMessage
  sending?: boolean
  assistantLabel?: string
  userLabel?: string
  errorLabel?: string
  retryLabel?: string
  /** Space that a floating composer covers at the end of the scroll viewport. */
  tailInset?: number
  variant?: 'desktop' | 'mobile'
  /**
   * How the bubbles paint their backgrounds. `opaque` is for hosts with
   * nothing behind the history, such as a transparent window over the
   * desktop, where translucent bubbles take the contrast of whatever is under
   * them.
   */
  surface?: 'translucent' | 'opaque'
  /**
   * When the scrollbar shows: while scrolling, or also while the pointer is
   * over the history. A host that passes clicks through the empty history
   * uses `hover`, so a scrollbar the wheel cannot reveal still appears.
   */
  scrollbar?: 'scroll' | 'hover'
  /**
   * `true` when the host shows the history as a feed that nobody scrolls or
   * reads by hand. The history then returns to the newest message, because
   * nobody can scroll it back.
   */
  passive?: boolean
  /**
   * Index of the first message that the history shows. The messages before
   * it fade out and become hidden, but keep their place, so the layout and
   * the scroll position never move. A hidden message takes no pointer. A
   * smaller value shows the messages again. The danmaku chat window uses it
   * to hide read messages.
   */
  expiredBefore?: number
  toolCallRenderers?: ChatToolCallRendererRegistry
  /** Widgets for tool results. Each assistant message passes them to its tool call groups. */
  toolCallWidgets?: ChatToolCallWidgetRegistry
  /**
   * Dahlia: the messages' menus have Edit, Branch from here, Delete everything after and, for her pictures, Set as
   * background. The host binds their events, as `useDahliaHistoryActions` handles them.
   */
  dahliaActions?: boolean
  /** Dahlia: her pictures' menus also have Float on the desktop (the desktop app binds `floatMessage`). */
  dahliaFloat?: boolean
}>(), {
  sending: false,
  tailInset: 0,
  variant: 'desktop',
  surface: 'translucent',
  scrollbar: 'scroll',
  passive: false,
  expiredBefore: 0,
  toolCallRenderers: () => ({}),
  toolCallWidgets: () => ({}),
  dahliaActions: false,
  dahliaFloat: false,
})

const emit = defineEmits<{
  (e: 'copyMessage', payload: { message: ChatHistoryItem, index: number, key: string | number }): void
  (e: 'deleteMessage', payload: { message: ChatHistoryItem, index: number, key: string | number }): void
  (e: 'replyMessage', payload: ChatHistoryReplyPayload): void
  (e: 'retryMessage', payload: { message: ChatHistoryItem, index: number, key: string | number }): void
  (e: 'toolCallRerun', payload: ChatToolCallRerunEvent): void
  (e: 'editMessage', payload: DahliaHistoryEditPayload): void
  (e: 'branchMessage', payload: DahliaHistoryActionPayload): void
  (e: 'trimMessage', payload: DahliaHistoryActionPayload): void
  (e: 'backgroundMessage', payload: DahliaHistoryBackgroundPayload): void
  (e: 'floatMessage', payload: DahliaHistoryBackgroundPayload): void
}>()

/** Keeps about two mobile viewports ready so fast flicks do not expose an unmounted gap. */
const CHAT_HISTORY_OVERSCAN = 600

const scrollContainerRef = useTemplateRef<InstanceType<typeof ChatHistoryScrollContainer>>('scroll-container')
const chatHistoryRef = computed<HTMLElement | null>(() => scrollContainerRef.value?.viewport ?? null)
const virtualizerRef = useTemplateRef<VirtualizerHandle>('virtualizer')
const tailInset = computed(() => props.tailInset)
const { scrollToIndex } = useVirtualizerScroll({
  tailInset,
  virtualizer: virtualizerRef,
})

const { t } = useI18n()
const now = useNow({ interval: 60_000 })
const labels = computed(() => ({
  assistant: props.assistantLabel ?? t('stage.chat.message.character-name.airi'),
  user: props.userLabel ?? t('stage.chat.message.character-name.you'),
  error: props.errorLabel ?? t('stage.chat.message.character-name.core-system'),
  retry: props.retryLabel ?? t('stage.chat.actions.retry'),
}))

const streaming = computed<StreamingAssistantMessage>(() => props.streamingMessage ?? { role: 'assistant', content: '', slices: [], tool_results: [] })
const showStreamingPlaceholder = computed(() => (streaming.value.slices?.length ?? 0) === 0 && !streaming.value.content)
function shouldShowPlaceholder(message: ChatHistoryItem) {
  return !!streaming.value.id && message.id === streaming.value.id
}
function canReplyToMessage(message: ChatHistoryItem) {
  if (!message.id)
    return false

  if (message.role !== 'assistant' && message.role !== 'user')
    return false

  // A notice is not a message from either side, so nobody replies to it.
  if (message.role === 'user' && message.notice)
    return false

  if (message.role === 'assistant' && shouldShowPlaceholder(message) && showStreamingPlaceholder.value)
    return false

  return getChatHistoryItemCopyText(message).trim().length > 0
}
const renderMessages = computed<ChatHistoryItem[]>(() => {
  if (!props.sending)
    return props.messages

  const streamId = streaming.value.id
  if (!streamId)
    return props.messages

  const hasStreamAlready = props.messages.some(message => message.role === 'assistant' && message.id === streamId)
  if (hasStreamAlready)
    return props.messages

  return [...props.messages, streaming.value]
})
function canRetryMessageAt(index: number) {
  const precedingMessage = renderMessages.value[index - 1]
  if (precedingMessage?.role === 'user')
    return true

  if (precedingMessage?.role === 'assistant' && precedingMessage.interrupted)
    return renderMessages.value[index - 2]?.role === 'user'

  return false
}
const messagesById = computed(() => new Map(
  renderMessages.value.flatMap(message => message.id ? [[message.id, message] as const] : []),
))
const renderMessageCount = computed(() => renderMessages.value.length)
const timeSeparators = computed(() => {
  let previousTimestamp: number | undefined
  return renderMessages.value.map((message) => {
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'error')
      return undefined
    const timestamp = message.createdAt
    if (timestamp == null || !Number.isFinite(timestamp) || Number.isNaN(new Date(timestamp).getTime()))
      return undefined
    const show = previousTimestamp == null || timestamp - previousTimestamp >= 5 * 60 * 1000
    previousTimestamp = timestamp
    return show ? timestamp : undefined
  })
})
const topFadeRatio = computed(() => props.variant === 'mobile' ? 0.2 : 0)

const { itemProps } = useVirtualizerBottomAlignment({
  container: chatHistoryRef,
  itemCount: renderMessageCount,
  virtualizer: virtualizerRef,
})

useChatHistoryScroll({
  container: chatHistoryRef,
  messages: renderMessages,
  getKey: getChatHistoryItemKey,
  scrollToIndex,
  tailInset,
  passive: computed(() => props.passive),
  hiddenBefore: computed(() => props.expiredBefore),
})
useChatHistoryTopFade({
  container: chatHistoryRef,
  fadeRatio: topFadeRatio,
})

// Dahlia: the message whose editor is open, by its key. A turn that runs changes the history, so nothing is edited,
// branched or trimmed meanwhile.
const editingKey = shallowRef<string | number>()
const dahliaChanges = computed(() => props.dahliaActions && !props.sending)

function canEditMessage(message: ChatHistoryItem) {
  if (!dahliaChanges.value || !message.id)
    return false
  if (message.role === 'user')
    return !message.notice
  return message.role === 'assistant' && !shouldShowPlaceholder(message)
}

function canBranchMessage(message: ChatHistoryItem) {
  return dahliaChanges.value && !!message.id && (message.role === 'user' || message.role === 'assistant')
}

function canTrimMessage(index: number) {
  return dahliaChanges.value && index < props.messages.length - 1
}

function pictureOf(message: ChatHistoryItem) {
  return props.dahliaActions ? dahliaPicturesIn(message).at(-1) : undefined
}

function isEditing(message: ChatHistoryItem, index: number) {
  return dahliaChanges.value && editingKey.value === getChatHistoryItemKey(message, index)
}

function startEdit(message: ChatHistoryItem, index: number) {
  editingKey.value = getChatHistoryItemKey(message, index)
}

function cancelEdit() {
  editingKey.value = undefined
}

function emitEditMessage(message: ChatHistoryItem, index: number, text: string, resend: boolean) {
  editingKey.value = undefined
  emit('editMessage', { message, index, key: getChatHistoryItemKey(message, index), text, resend })
}

function emitBranchMessage(message: ChatHistoryItem, index: number) {
  emit('branchMessage', { message, index, key: getChatHistoryItemKey(message, index) })
}

function emitTrimMessage(message: ChatHistoryItem, index: number) {
  emit('trimMessage', { message, index, key: getChatHistoryItemKey(message, index) })
}

function emitBackgroundMessage(message: ChatHistoryItem, index: number) {
  const picture = pictureOf(message)
  if (picture)
    emit('backgroundMessage', { message, index, key: getChatHistoryItemKey(message, index), ...picture })
}

function emitFloatMessage(message: ChatHistoryItem, index: number) {
  const picture = pictureOf(message)
  if (picture)
    emit('floatMessage', { message, index, key: getChatHistoryItemKey(message, index), ...picture })
}

function emitCopyMessage(message: ChatHistoryItem, index: number) {
  emit('copyMessage', {
    message,
    index,
    key: getChatHistoryItemKey(message, index),
  })
}

function emitDeleteMessage(message: ChatHistoryItem, index: number) {
  emit('deleteMessage', {
    message,
    index,
    key: getChatHistoryItemKey(message, index),
  })
}

function emitRetryMessage(message: ChatHistoryItem, index: number) {
  emit('retryMessage', {
    message,
    index,
    key: getChatHistoryItemKey(message, index),
  })
}

function emitReplyMessage(message: ChatHistoryItem) {
  if (!canReplyToMessage(message))
    return

  emit('replyMessage', {
    message,
    label: message.role === 'assistant' ? labels.value.assistant : labels.value.user,
  })
}

function getReplyTarget(message: ChatHistoryItem): ChatHistoryReplyPayload | undefined {
  if (!message.replyToMessageId)
    return undefined

  const target = messagesById.value.get(message.replyToMessageId)
  if (!target || (target.role !== 'assistant' && target.role !== 'user'))
    return undefined

  return {
    label: target.role === 'assistant' ? labels.value.assistant : labels.value.user,
    message: target,
  }
}

/**
 * Triggering workflow: ChatAssistantItem `toolCallRerun` -> emitToolCallRerun
 * -> the parent runtime's tool rerun handler, with this message location.
 */
function emitToolCallRerun(
  message: ChatHistoryItem,
  index: number,
  payload: ToolCallRerunRequest,
) {
  emit('toolCallRerun', {
    message,
    index,
    key: getChatHistoryItemKey(message, index),
    ...payload,
  })
}
</script>

<template>
  <ChatHistoryScrollContainer
    ref="scroll-container"
    v-bind="$attrs"
    :variant="variant"
    :scrollbar="scrollbar"
  >
    <Virtualizer
      ref="virtualizer"
      :data="renderMessages"
      :buffer-size="CHAT_HISTORY_OVERSCAN"
      :item-props="itemProps"
      :scroll-ref="chatHistoryRef ?? undefined"
    >
      <template #default="{ item: message, index }">
        <div :key="getChatHistoryItemKey(message, index)">
          <!-- An expired message takes its time label with it, so no label floats in an empty feed. -->
          <ChatHistoryTimeSeparator
            v-if="timeSeparators[index] != null"
            :timestamp="timeSeparators[index]!"
            :now="now.getTime()"
            :class="['transition-[opacity,visibility] duration-200 ease-out motion-reduce:transition-none', index < expiredBefore ? 'invisible opacity-0' : '']"
          />
          <!-- Audio end-to-end tests read rendered messages through data-chat-message-role. -->
          <ChatHistoryMessageFrame
            :key="getChatHistoryItemKey(message, index)"
            :data-chat-message-role="message.role"
            :variant="variant"
            :scroll-container="chatHistoryRef"
            :reply-enabled="canReplyToMessage(message)"
            :expired="index < expiredBefore"
            @reply="emitReplyMessage(message)"
          >
            <ChatErrorItem
              v-if="message.role === 'error'"
              :message="message"
              :label="labels.error"
              :retry-label="labels.retry"
              :can-retry="canRetryMessageAt(index)"
              :show-placeholder="sending && index === renderMessages.length - 1"
              :scroll-container="chatHistoryRef"
              :variant="variant"
              :surface="surface"
              @copy="emitCopyMessage(message, index)"
              @retry="emitRetryMessage(message, index)"
              @delete="emitDeleteMessage(message, index)"
            />
            <ChatAssistantItem
              v-else-if="message.role === 'assistant'"
              :message="message"
              :label="labels.assistant"
              :reply-target="getReplyTarget(message)"
              :can-reply="canReplyToMessage(message)"
              :show-placeholder="shouldShowPlaceholder(message) && showStreamingPlaceholder"
              :streaming="shouldShowPlaceholder(message)"
              :scroll-container="chatHistoryRef"
              :variant="variant"
              :surface="surface"
              :tool-call-renderers="toolCallRenderers"
              :tool-call-widgets="toolCallWidgets"
              :editing="isEditing(message, index)"
              :can-edit="canEditMessage(message)"
              :can-branch="canBranchMessage(message)"
              :can-trim="canTrimMessage(index)"
              :can-set-background="!!pictureOf(message)"
              :can-float="dahliaFloat && !!pictureOf(message)"
              @copy="emitCopyMessage(message, index)"
              @delete="emitDeleteMessage(message, index)"
              @reply="emitReplyMessage(message)"
              @tool-call-rerun="emitToolCallRerun(message, index, $event)"
              @edit="startEdit(message, index)"
              @save-edit="(text, resend) => emitEditMessage(message, index, text, resend)"
              @cancel-edit="cancelEdit"
              @branch="emitBranchMessage(message, index)"
              @trim="emitTrimMessage(message, index)"
              @background="emitBackgroundMessage(message, index)"
              @float="emitFloatMessage(message, index)"
            />
            <ChatNoticeItem
              v-else-if="message.role === 'user' && message.notice"
              :message="message"
              :surface="surface"
            />
            <ChatUserItem
              v-else-if="message.role === 'user'"
              :message="message"
              :label="labels.user"
              :reply-target="getReplyTarget(message)"
              :can-reply="canReplyToMessage(message)"
              :scroll-container="chatHistoryRef"
              :variant="variant"
              :surface="surface"
              :editing="isEditing(message, index)"
              :can-edit="canEditMessage(message)"
              :can-branch="canBranchMessage(message)"
              :can-trim="canTrimMessage(index)"
              @copy="emitCopyMessage(message, index)"
              @delete="emitDeleteMessage(message, index)"
              @reply="emitReplyMessage(message)"
              @edit="startEdit(message, index)"
              @save-edit="(text, resend) => emitEditMessage(message, index, text, resend)"
              @cancel-edit="cancelEdit"
              @branch="emitBranchMessage(message, index)"
              @trim="emitTrimMessage(message, index)"
            />
          </ChatHistoryMessageFrame>
        </div>
      </template>
    </Virtualizer>
  </ChatHistoryScrollContainer>
</template>
