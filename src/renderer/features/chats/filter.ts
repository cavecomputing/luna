import type { Conversation } from '../../../shared/types.js'

const EXCERPT_LENGTH = 110
const EXCERPT_CONTEXT = 36

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function matchIndex(value: string, query: string): number {
  return normalized(value).toLowerCase().indexOf(query)
}

/** Search conversation titles and message text without changing the stored content. */
export function filterChats(chats: Conversation[], query: string): Conversation[] {
  const q = normalized(query).toLowerCase()
  if (q === '') return chats
  return chats.filter(
    (chat) =>
      chat.title.toLowerCase().includes(q) ||
      chat.messages.some(
        (message) =>
          matchIndex(message.text, q) >= 0 ||
          (message.reasoning !== undefined && matchIndex(message.reasoning, q) >= 0),
      ),
  )
}

/** A short window around the first message-text or reasoning match. */
export function messageExcerpt(chat: Conversation, query: string): string | undefined {
  const q = normalized(query).toLowerCase()
  if (q === '') return undefined

  for (const message of chat.messages) {
    for (const content of [message.text, message.reasoning]) {
      if (content === undefined) continue
      const text = normalized(content)
      const index = text.toLowerCase().indexOf(q)
      if (index < 0) continue
      if (text.length <= EXCERPT_LENGTH) return text

      const start = Math.max(0, index - EXCERPT_CONTEXT)
      const end = Math.min(text.length, start + EXCERPT_LENGTH)
      return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
    }
  }

  return undefined
}

/** Pinned first, then newest within each group. */
export function byRecency(chats: Conversation[]): Conversation[] {
  return [...chats].sort((a, b) => {
    const pinOrder = Number(b.pinned) - Number(a.pinned)
    return pinOrder === 0 ? b.updatedAt - a.updatedAt : pinOrder
  })
}
