import type { ConversationSummary } from '../../../shared/types.js'

/*
 * Title and message search moved to main, where it runs as a SQLite query
 * rather than a scan of every message held in the renderer. What is left here
 * is ordering and grouping, which only need summaries.
 */

/** Pinned first, then newest within each group. */
export function byRecency<T extends ConversationSummary>(chats: T[]): T[] {
  return [...chats].sort((a, b) => {
    const pinOrder = Number(b.pinned) - Number(a.pinned)
    return pinOrder === 0 ? b.updatedAt - a.updatedAt : pinOrder
  })
}

export function groupChats<T extends ConversationSummary>(chats: T[]): {
  pinned: T[]
  recent: T[]
} {
  return {
    pinned: chats.filter((chat) => chat.pinned),
    recent: chats.filter((chat) => !chat.pinned),
  }
}
