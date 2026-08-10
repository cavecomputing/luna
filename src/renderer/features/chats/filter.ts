import type { Conversation } from '../../../shared/types.js'

/** Search conversation titles and message text without changing the stored content. */
export function filterChats(chats: Conversation[], query: string): Conversation[] {
  const q = query.trim().toLowerCase()
  if (q === '') return chats
  return chats.filter(
    (chat) =>
      chat.title.toLowerCase().includes(q) ||
      chat.messages.some((message) => message.text.toLowerCase().includes(q)),
  )
}

/** Pinned first, then newest within each group. */
export function byRecency(chats: Conversation[]): Conversation[] {
  return [...chats].sort((a, b) => {
    const pinOrder = Number(b.pinned === true) - Number(a.pinned === true)
    return pinOrder === 0 ? b.updatedAt - a.updatedAt : pinOrder
  })
}
