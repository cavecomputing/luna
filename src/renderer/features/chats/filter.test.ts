import { describe, expect, it } from 'vitest'
import type { ConversationSummary } from '../../../shared/types.js'
import { byRecency, groupChats } from './filter.js'

const chat = (
  id: string,
  title: string,
  updatedAt: number,
  pinned = false,
): ConversationSummary => ({
  id,
  title,
  draft: '',
  mode: 'fast',
  pinned,
  updatedAt,
})

const chats = [
  chat('a', 'Weekend trip to the coast', 300),
  chat('b', 'Easy weeknight dinners', 100),
  chat('c', 'Book recommendations', 200),
]

describe('byRecency', () => {
  it('orders newest first', () => {
    expect(byRecency(chats).map((item) => item.id)).toEqual(['a', 'c', 'b'])
  })

  it('puts pinned conversations ahead of newer unpinned ones', () => {
    const withPin = [...chats, chat('d', 'Pinned but old', 1, true)]
    expect(byRecency(withPin).map((item) => item.id)).toEqual(['d', 'a', 'c', 'b'])
  })

  it('does not mutate its input', () => {
    const input = [...chats]
    byRecency(input)
    expect(input.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('groupChats', () => {
  it('splits pinned from recent', () => {
    const grouped = groupChats([...chats, chat('d', 'Kept', 5, true)])
    expect(grouped.pinned.map((item) => item.id)).toEqual(['d'])
    expect(grouped.recent.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })
})
