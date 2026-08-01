import { useMemo, useState } from 'react'
import type { Conversation, Message, Mode } from '../../../shared/types.js'
import { byRecency, filterChats } from './filter.js'

export type Chats = ReturnType<typeof useChats>

/**
 * Owns the conversation list, the search query and which chat is open.
 *
 * Lifted to the app shell because the sidebar, the thread and the composer all
 * read it. When conversations move to main this hook is the only thing that
 * changes — every component below it keeps its props.
 */
export function useChats(initial: Conversation[], defaultMode: Mode) {
  const [chats, setChats] = useState<Conversation[]>(initial)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | undefined>(initial[0]?.id)

  const visible = useMemo(() => byRecency(filterChats(chats, query)), [chats, query])
  const open = chats.find((c) => c.id === openId)

  function start(): void {
    const chat: Conversation = {
      id: `c${String(Date.now())}`,
      title: 'New chat',
      icon: 'spark',
      // Read here, not captured at mount, so changing the pref in Settings
      // affects the very next chat without a reload.
      mode: defaultMode,
      updatedAt: Date.now(),
      messages: [],
    }
    setChats((prev) => [chat, ...prev])
    setOpenId(chat.id)
    setQuery('')
  }

  function send(text: string): void {
    if (openId === undefined) return
    const message: Message = {
      id: `m${String(Date.now())}`,
      role: 'user',
      text,
      at: Date.now(),
    }
    setChats((prev) =>
      prev.map((c) =>
        c.id === openId
          ? { ...c, messages: [...c.messages, message], updatedAt: message.at }
          : c,
      ),
    )
  }

  function setMode(mode: Mode): void {
    if (openId === undefined) return
    setChats((prev) => prev.map((c) => (c.id === openId ? { ...c, mode } : c)))
  }

  return { visible, open, query, setQuery, openId, setOpenId, start, send, setMode }
}
