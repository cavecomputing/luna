import { describe, expect, it } from 'vitest'
import type { Conversation } from '../../../shared/types.js'
import { byRecency, filterChats } from './filter.js'

const chat = (id: string, title: string, updatedAt: number): Conversation => ({
  id,
  title,
  draft: '',
  icon: 'spark',
  mode: 'fast',
  pinned: false,
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

  it('matches message text when the title does not match', () => {
    const withBody = [
      { ...chat('d', 'Untitled', 1), messages: [{ id: 'm', role: 'user' as const, text: 'submarine', status: 'complete' as const, at: 1, attachments: [] }] },
    ]
    expect(filterChats(withBody, 'submarine').map((item) => item.id)).toEqual(['d'])
  })

  it('ignores case when matching message text', () => {
    const withBody = [
      { ...chat('d', 'Untitled', 1), messages: [{ id: 'm', role: 'assistant' as const, text: 'Coastal route', status: 'complete' as const, at: 1, attachments: [] }] },
    ]
    expect(filterChats(withBody, 'COASTAL').map((item) => item.id)).toEqual(['d'])
  })

  it('matches separately stored thinking text', () => {
    const withReasoning = [
      {
        ...chat('d', 'Untitled', 1),
        messages: [
          {
            id: 'm',
            role: 'assistant' as const,
            text: 'Final answer',
            reasoning: 'Checked the submarine route',
            status: 'complete' as const,
            at: 1,
            attachments: [],
          },
        ],
      },
    ]
    expect(filterChats(withReasoning, 'submarine').map((item) => item.id)).toEqual(['d'])
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

  it('places pinned chats first and keeps each group newest-first', () => {
    const pinned = chats.map((item) =>
      item.id === 'b' || item.id === 'c' ? { ...item, pinned: true } : item,
    )
    expect(byRecency(pinned).map((c) => c.id)).toEqual(['c', 'b', 'a'])
  })
})
