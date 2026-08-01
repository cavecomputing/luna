import { describe, expect, it } from 'vitest'
import type { Conversation } from '../../../shared/types.js'
import { byRecency, filterChats } from './filter.js'

const chat = (id: string, title: string, updatedAt: number): Conversation => ({
  id,
  title,
  icon: 'spark',
  mode: 'fast',
  updatedAt,
  messages: [],
})

const chats = [
  chat('a', 'Weekend trip to the coast', 300),
  chat('b', 'Easy weeknight dinners', 100),
  chat('c', 'Book recommendations', 200),
]

describe('filterChats', () => {
  it('returns every chat for an empty query', () => {
    expect(filterChats(chats, '')).toHaveLength(3)
  })

  it('returns every chat for a whitespace-only query', () => {
    expect(filterChats(chats, '   ')).toHaveLength(3)
  })

  it('matches on a substring of the title', () => {
    expect(filterChats(chats, 'week').map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('ignores case', () => {
    expect(filterChats(chats, 'BOOK').map((c) => c.id)).toEqual(['c'])
  })

  it('returns nothing when no title matches', () => {
    expect(filterChats(chats, 'submarine')).toEqual([])
  })

  it('does not search message bodies', () => {
    const withBody = [
      { ...chat('d', 'Untitled', 1), messages: [{ id: 'm', role: 'user' as const, text: 'submarine', at: 1 }] },
    ]
    expect(filterChats(withBody, 'submarine')).toEqual([])
  })
})

describe('byRecency', () => {
  it('sorts newest first', () => {
    expect(byRecency(chats).map((c) => c.id)).toEqual(['a', 'c', 'b'])
  })

  it('does not mutate its input', () => {
    const order = chats.map((c) => c.id)
    byRecency(chats)
    expect(chats.map((c) => c.id)).toEqual(order)
  })
})
