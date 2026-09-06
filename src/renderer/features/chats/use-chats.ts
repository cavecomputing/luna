import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatDelta, ChatFinal, ChatStart } from '../../../shared/ipc.js'
import type { ConversationSummary, Message, Mode } from '../../../shared/types.js'
import { byRecency } from './filter.js'

export type Chats = ReturnType<typeof useChats>

/** Stable identity, so an unloaded thread does not re-render on every pass. */
const NO_MESSAGES: Message[] = []

function deltaKey(delta: Pick<ChatDelta, 'conversationId' | 'messageId'>): string {
  return `${delta.conversationId}:${delta.messageId}`
}

export function queueDelta(pending: Map<string, ChatDelta>, delta: ChatDelta): void {
  const key = deltaKey(delta)
  const queued = pending.get(key)
  if (queued === undefined || queued.seq < delta.seq) pending.set(key, delta)
}

/** Deltas now update the open conversation's messages, not every conversation. */
export function applyDeltas(messages: Message[], deltas: Iterable<ChatDelta>): Message[] {
  let next = messages
  for (const delta of deltas) next = applyDelta(next, delta)
  return next
}

export function applyDelta(messages: Message[], delta: ChatDelta): Message[] {
  return messages.map((message) =>
    message.id !== delta.messageId ||
    message.status !== 'streaming' ||
    (message.streamSeq ?? 0) >= delta.seq
      ? message
      : { ...message, text: delta.text, reasoning: delta.reasoning, streamSeq: delta.seq },
  )
}

export function applyFinal(messages: Message[], final: ChatFinal): Message[] {
  return messages.map((message) =>
    message.id === final.message.id ? final.message : message,
  )
}

/** Adds the two freshly persisted rows without duplicating a raced reload. */
export function applyStart(messages: Message[], start: ChatStart): Message[] {
  const added = new Set(start.messages.map((message) => message.id))
  return [...messages.filter((message) => !added.has(message.id)), ...start.messages]
}

/**
 * Merges a broadcast list into the current one, keeping the draft being typed.
 *
 * Message bodies used to be preserved here too, because the broadcast carried
 * them and would have overwritten in-flight streamed text. It no longer does,
 * which is the point of the change — a list update cannot disturb the thread.
 */
export function mergeChats(
  current: ConversationSummary[],
  incoming: ConversationSummary[],
): ConversationSummary[] {
  const priorChats = new Map(current.map((chat) => [chat.id, chat] as const))
  const seen = new Set<string>()
  return incoming.flatMap((chat) => {
    if (seen.has(chat.id)) return []
    seen.add(chat.id)
    return [{ ...chat, draft: priorChats.get(chat.id)?.draft ?? chat.draft }]
  })
}

function friendlyError(code: string): string {
  if (code === 'chat/no-provider') return 'Choose a provider for this mode in Settings.'
  if (code === 'chat/no-model') return 'Choose a model for this mode in Settings.'
  if (code === 'chat/auth') return 'The provider rejected its API key.'
  if (code === 'chat/rate-limit') return 'The provider rate limit was reached. Try again shortly.'
  if (code === 'chat/network') return 'Luna could not reach the provider.'
  if (code === 'chat/attachments-unsupported') {
    return 'This provider or model does not support one or more attachments.'
  }
  if (code === 'chat/attachments-too-large') {
    return 'The provider rejected the attachment payload as too large.'
  }
  if (code === 'chat/invalid-attachments') {
    return 'The selected attachments changed before the message was sent. Please try again.'
  }
  if (code === 'secret/unavailable') return 'The saved API key could not be read.'
  return 'The message could not be completed. Please try again.'
}

/** Main owns persistence and requests; this hook mirrors its typed events. */
export function useChats(defaultMode: Mode) {
  const [chats, setChats] = useState<ConversationSummary[]>([])
  const [openId, setOpenId] = useState<string>()
  /**
   * Messages tagged with the conversation they belong to.
   *
   * Deriving the visible list from this rather than clearing on every change
   * means a slow load that lands after the user has moved on cannot paint one
   * conversation's messages into another's thread.
   */
  const [loaded, setLoaded] = useState<{ id: string; messages: Message[] }>()
  /**
   * The most recent delta per streaming message, kept until that message
   * finishes. Reopening a conversation refetches from the database, which only
   * holds text once the turn ends — this is what stops switching away and back
   * mid-stream from blanking the reply.
   */
  const live = useRef(new Map<string, ChatDelta>())
  /** Rows returned by a send, kept until any older in-flight load is merged over them. */
  const started = useRef(new Map<string, ChatStart>())
  const loading = useRef(new Map<string, number>())
  const [draftMode, setDraftMode] = useState<Mode>()
  const [renameId, setRenameId] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    const pending = new Map<string, ChatDelta>()
    let deltaFrame: number | undefined
    const flushDeltas = (): void => {
      deltaFrame = undefined
      const batch = [...pending.values()]
      pending.clear()
      if (batch.length > 0) {
        setLoaded((current) =>
          current === undefined
            ? current
            : { ...current, messages: applyDeltas(current.messages, batch) },
        )
      }
    }
    void window.luna.chats.list().then((result) => {
      if (!alive) return
      if (!result.ok) {
        setError('Conversations could not be loaded.')
        return
      }
      setChats(result.value)
      setOpenId((current) =>
        current !== undefined && result.value.some((chat) => chat.id === current)
          ? current
          : byRecency(result.value)[0]?.id,
      )
    })
    const offChats = window.luna.onChats((value) => {
      setChats((current) => mergeChats(current, value))
      setOpenId((current) =>
        current !== undefined && value.some((chat) => chat.id === current)
          ? current
          : byRecency(value)[0]?.id,
      )
    })
    const offDelta = window.luna.onChatDelta((value) => {
      live.current.set(value.messageId, value)
      queueDelta(pending, value)
      deltaFrame ??= requestAnimationFrame(flushDeltas)
    })
    const offDone = window.luna.onChatDone((value) => {
      live.current.delete(value.message.id)
      pending.delete(deltaKey({ conversationId: value.conversationId, messageId: value.message.id }))
      const recent = started.current.get(value.conversationId)
      if (recent !== undefined) {
        started.current.set(value.conversationId, {
          ...recent,
          messages: applyFinal(recent.messages, value),
        })
      }
      setLoaded((current) =>
        current === undefined ? current : { ...current, messages: applyFinal(current.messages, value) },
      )
    })
    const offError = window.luna.onChatError((value) => {
      live.current.delete(value.message.id)
      pending.delete(deltaKey({ conversationId: value.conversationId, messageId: value.message.id }))
      const recent = started.current.get(value.conversationId)
      if (recent !== undefined) {
        started.current.set(value.conversationId, {
          ...recent,
          messages: applyFinal(recent.messages, value),
        })
      }
      setLoaded((current) =>
        current === undefined ? current : { ...current, messages: applyFinal(current.messages, value) },
      )
      setError(friendlyError(value.code))
    })
    const offRename = window.luna.onRenameChat(({ id }) => {
      setRenameId(id)
    })
    return () => {
      alive = false
      offChats()
      offDelta()
      offDone()
      offError()
      offRename()
      if (deltaFrame !== undefined) cancelAnimationFrame(deltaFrame)
    }
  }, [])

  // Message bodies are fetched for the conversation being read, so opening one
  // costs the same whether there are five conversations or five thousand.
  useEffect(() => {
    if (openId === undefined) return undefined
    let alive = true
    loading.current.set(openId, (loading.current.get(openId) ?? 0) + 1)
    void window.luna.chats
      .messages(openId)
      .then((result) => {
        if (!alive || !result.ok) return
        const recent = started.current.get(openId)
        const messages = recent === undefined ? result.value : applyStart(result.value, recent)
        setLoaded({ id: openId, messages: applyDeltas(messages, live.current.values()) })
      })
      .finally(() => {
        const remaining = (loading.current.get(openId) ?? 1) - 1
        if (remaining > 0) loading.current.set(openId, remaining)
        else {
          loading.current.delete(openId)
          started.current.delete(openId)
        }
      })
    return () => {
      alive = false
    }
  }, [openId])

  const visible = useMemo(() => byRecency(chats), [chats])
  const summary = chats.find((chat) => chat.id === openId)
  const messages =
    loaded !== undefined && loaded.id === openId ? loaded.messages : NO_MESSAGES
  const open = summary === undefined ? undefined : { ...summary, messages }
  const streamingMessage = messages.find((message) => message.status === 'streaming')
  const currentMode = summary?.mode ?? draftMode ?? defaultMode

  async function start(): Promise<void> {
    setError(undefined)
    const result = await window.luna.chats.create(draftMode ?? defaultMode)
    if (!result.ok) {
      setError('A new conversation could not be created.')
      return
    }
    setChats((current) => mergeChats(current, [result.value, ...current]))
    setLoaded({ id: result.value.id, messages: [] })
    setOpenId(result.value.id)
  }

  async function ensure(): Promise<ConversationSummary | undefined> {
    if (summary !== undefined) return summary
    const created = await window.luna.chats.create(draftMode ?? defaultMode)
    if (!created.ok) {
      setError('A new conversation could not be created.')
      return undefined
    }
    setChats((current) => mergeChats(current, [created.value, ...current]))
    setLoaded({ id: created.value.id, messages: [] })
    setOpenId(created.value.id)
    return created.value
  }

  async function send(text: string, attachmentIds: string[] = []): Promise<boolean> {
    setError(undefined)
    const conversation = await ensure()
    if (conversation === undefined) return false

    const result = await window.luna.chat.send(conversation.id, text, attachmentIds)
    if (!result.ok) {
      setError(friendlyError(result.code))
      return false
    }
    setChats((current) => {
      const without = current.filter((chat) => chat.id !== result.value.conversation.id)
      return mergeChats(current, [result.value.conversation, ...without])
    })
    if ((loading.current.get(result.value.conversation.id) ?? 0) > 0) {
      started.current.set(result.value.conversation.id, result.value)
    }
    setLoaded((current) =>
      current !== undefined && current.id !== result.value.conversation.id
        ? current
        : {
            id: result.value.conversation.id,
            messages: applyStart(current?.messages ?? [], result.value),
          },
    )
    setOpenId(result.value.conversation.id)
    return true
  }

  async function cancel(): Promise<void> {
    if (streamingMessage === undefined) return
    const result = await window.luna.chat.cancel(streamingMessage.id)
    if (!result.ok && result.code !== 'chat/not-active') setError(friendlyError(result.code))
  }

  /**
   * The notice belongs to the send that failed, not to the window. Carrying it
   * into the next conversation would blame a thread that never made a request.
   */
  function openChat(id: string): void {
    setError(undefined)
    setOpenId(id)
  }

  function setMode(mode: Mode): void {
    setError(undefined)
    if (open === undefined) {
      setDraftMode(mode)
      return
    }
    void window.luna.chats.setMode(open.id, mode).then((result) => {
      if (!result.ok) {
        setError('The conversation mode could not be changed.')
        return
      }
      setChats((current) => current.map((chat) => (chat.id === open.id ? result.value : chat)))
    })
  }

  function setDraft(draft: string): void {
    if (open === undefined) return
    setChats((current) =>
      current.map((chat) => (chat.id === open.id ? { ...chat, draft } : chat)),
    )
    void window.luna.chats.setDraft(open.id, draft).then((result) => {
      if (!result.ok) setError('The conversation draft could not be saved.')
    })
  }

  function togglePinned(id: string): void {
    const found = chats.find((chat) => chat.id === id)
    if (found === undefined) return
    void window.luna.chats.setPinned(id, !found.pinned).then((result) => {
      if (!result.ok) setError('The conversation could not be pinned.')
    })
  }

  function remove(id: string): void {
    void window.luna.chats.delete(id).then((result) => {
      if (!result.ok) setError('The conversation could not be deleted.')
    })
  }

  function rename(id: string, title: string): void {
    void window.luna.chats.rename(id, title).then((result) => {
      if (!result.ok) {
        setError('The conversation could not be renamed.')
        setRenameId(undefined)
        return
      }
      setChats((current) => current.map((chat) => (chat.id === id ? result.value : chat)))
      setRenameId(undefined)
    })
  }

  function cancelRename(): void {
    setRenameId(undefined)
  }

  return {
    visible,
    all: chats,
    open,
    openId,
    currentMode,
    streamingMessage,
    error,
    renameId,
    openChat,
    start,
    ensure,
    send,
    cancel,
    setMode,
    setDraft,
    togglePinned,
    remove,
    rename,
    cancelRename,
  }
}
