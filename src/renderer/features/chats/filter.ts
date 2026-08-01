import type { Conversation } from '../../../shared/types.js'

/**
 * Search matches on title only. Message bodies are deliberately excluded —
 * searching private conversation text is a feature to design on purpose,
 * not a side effect of a filter.
 */
export function filterChats(chats: Conversation[], query: string): Conversation[] {
  const q = query.trim().toLowerCase()
  if (q === '') return chats
  return chats.filter((c) => c.title.toLowerCase().includes(q))
}

/** Newest first. */
export function byRecency(chats: Conversation[]): Conversation[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
}
