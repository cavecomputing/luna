import { useEffect, useMemo, useState } from 'react'
import type { ChatDelta, ChatFinal } from '../../../shared/ipc.js'
import type { Conversation, Mode } from '../../../shared/types.js'
import { byRecency } from './filter.js'

export type Chats = ReturnType<typeof useChats>

function deltaKey(delta: Pick<ChatDelta, 'conversationId' | 'messageId'>): string {
  return `${delta.conversationId}:${delta.messageId}`
}

export function queueDelta(pending: Map<string, ChatDelta>, delta: ChatDelta): void {
  const key = deltaKey(delta)
  const queued = pending.get(key)
  if (queued === undefined || queued.seq < delta.seq) pending.set(key, delta)
}

export function applyDeltas(chats: Conversation[], deltas: Iterable<ChatDelta>): Conversation[] {
  let next = chats
  for (const delta of deltas) next = applyDelta(next, delta)
  return next
}

export function applyDelta(chats: Conversation[], delta: ChatDelta): Conversation[] {
  return chats.map((chat) =>
    chat.id !== delta.conversationId
      ? chat
      : {
          ...chat,
          messages: chat.messages.map((message) =>
            message.id !== delta.messageId ||
            message.status !== 'streaming' ||
            (message.streamSeq ?? 0) >= delta.seq
              ? message
              : {
                  ...message,
                  text: delta.text,
                  reasoning: delta.reasoning,
                  streamSeq: delta.seq,
                },
          ),
        },
  )
}

export function applyFinal(chats: Conversation[], final: ChatFinal): Conversation[] {
  return chats.map((chat) =>
    chat.id !== final.conversationId
      ? chat
      : {
          ...chat,
          messages: chat.messages.map((message) =>
            message.id === final.message.id ? final.message : message,
          ),
        },
  )
}

/** Keep in-flight renderer text when an unrelated database broadcast arrives. */
export function mergeChats(
  current: Conversation[],
  incoming: Conversation[],
): Conversation[] {
  const prior = new Map(
    current.flatMap((chat) => chat.messages.map((message) => [message.id, message] as const)),
  )
  const seen = new Set<string>()
  return incoming.flatMap((chat) => {
    if (seen.has(chat.id)) return []
    seen.add(chat.id)
    return [{
      ...chat,
      messages: chat.messages.map((message) => {
        const streamed = prior.get(message.id)
        return message.status === 'streaming' && streamed?.status === 'streaming'
          ? {
              ...message,
              text: streamed.text,
              ...(streamed.reasoning === undefined ? {} : { reasoning: streamed.reasoning }),
              ...(streamed.streamSeq === undefined ? {} : { streamSeq: streamed.streamSeq }),
            }
          : message
      }),
    }]
  })
}

function friendlyError(code: string): string {
  if (code === 'chat/no-provider') return 'Choose a provider for this mode in Settings.'
  if (code === 'chat/no-model') return 'Choose a model for this mode in Settings.'
  if (code === 'chat/auth') return 'The provider rejected its API key.'
  if (code === 'chat/rate-limit') return 'The provider rate limit was reached. Try again shortly.'
  if (code === 'chat/network') return 'Luna could not reach the provider.'
  if (code === 'secret/unavailable') return 'The saved API key could not be read.'
  return 'The message could not be completed. Please try again.'
}

/** Main owns persistence and requests; this hook mirrors its typed events. */
export function useChats(defaultMode: Mode) {
  const [chats, setChats] = useState<Conversation[]>([])
  const [openId, setOpenId] = useState<string>()
  const [draftMode, setDraftMode] = useState<Mode>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    const pending = new Map<string, ChatDelta>()
    let deltaFrame: number | undefined
    const flushDeltas = (): void => {
      deltaFrame = undefined
      const batch = [...pending.values()]
      pending.clear()
      if (batch.length > 0) setChats((current) => applyDeltas(current, batch))
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
      queueDelta(pending, value)
      deltaFrame ??= requestAnimationFrame(flushDeltas)
    })
    const offDone = window.luna.onChatDone((value) => {
      pending.delete(deltaKey({ conversationId: value.conversationId, messageId: value.message.id }))
      setChats((current) => applyFinal(current, value))
    })
    const offError = window.luna.onChatError((value) => {
      pending.delete(deltaKey({ conversationId: value.conversationId, messageId: value.message.id }))
      setChats((current) => applyFinal(current, value))
      setError(friendlyError(value.code))
    })
    return () => {
      alive = false
      offChats()
      offDelta()
      offDone()
      offError()
      if (deltaFrame !== undefined) cancelAnimationFrame(deltaFrame)
    }
  }, [])

  const visible = useMemo(() => byRecency(chats), [chats])
  const open = chats.find((chat) => chat.id === openId)
  const streamingMessage = open?.messages.find((message) => message.status === 'streaming')
  const currentMode = open?.mode ?? draftMode ?? defaultMode

  async function start(): Promise<void> {
    setError(undefined)
    const result = await window.luna.chats.create(draftMode ?? defaultMode)
    if (!result.ok) {
      setError('A new conversation could not be created.')
      return
    }
    setChats((current) => mergeChats(current, [result.value, ...current]))
    setOpenId(result.value.id)
  }

  async function send(text: string): Promise<boolean> {
    setError(undefined)
    let conversation = open
    if (conversation === undefined) {
      const created = await window.luna.chats.create(draftMode ?? defaultMode)
      if (!created.ok) {
        setError('A new conversation could not be created.')
        return false
      }
      conversation = created.value
      setChats((current) => mergeChats(current, [created.value, ...current]))
      setOpenId(created.value.id)
    }

    const result = await window.luna.chat.send(conversation.id, text)
    if (!result.ok) {
      setError(friendlyError(result.code))
      return false
    }
    setChats((current) => {
      const without = current.filter((chat) => chat.id !== result.value.conversation.id)
      return mergeChats(current, [result.value.conversation, ...without])
    })
    setOpenId(result.value.conversation.id)
    return true
  }

  async function cancel(): Promise<void> {
    if (streamingMessage === undefined) return
    const result = await window.luna.chat.cancel(streamingMessage.id)
    if (!result.ok && result.code !== 'chat/not-active') setError(friendlyError(result.code))
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

  return {
    visible,
    all: chats,
    open,
    openId,
    currentMode,
    streamingMessage,
    error,
    setOpenId,
    start,
    send,
    cancel,
    setMode,
    togglePinned,
    remove,
  }
}
