import { describe, expect, it } from 'vitest'
import { open } from './db.js'
import {
  beginTurn,
  create,
  find,
  finishMessage,
  history,
  list,
  messageText,
  recoverInterrupted,
  remove,
  setDraft,
  setMode,
  setPinned,
} from './chats.js'

describe('chat storage', () => {
  it('creates, updates, lists, and deletes conversations', () => {
    const db = open(':memory:')
    expect(create(db, 'chat-1', 'fast', 10)).toMatchObject({
      id: 'chat-1',
      mode: 'fast',
      pinned: false,
      messages: [],
    })
    expect(setDraft(db, 'chat-1', 'unfinished')).toBe(true)
    expect(find(db, 'chat-1')?.draft).toBe('unfinished')
    expect(setMode(db, 'chat-1', 'expert')?.mode).toBe('expert')
    expect(setPinned(db, 'chat-1', true)?.pinned).toBe(true)
    expect(list(db)).toHaveLength(1)
    expect(remove(db, 'chat-1')).toBe(true)
    expect(find(db, 'chat-1')).toBeUndefined()
  })

  it('stores a turn atomically and finishes the assistant message', () => {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    const turn = beginTurn(db, 'chat-1', 'Hello', 'user-1', 'assistant-1', 20)
    expect(turn?.conversation.draft).toBe('')
    expect(turn?.conversation.messages).toEqual([
      { id: 'user-1', role: 'user', text: 'Hello', status: 'complete', at: 20 },
      { id: 'assistant-1', role: 'assistant', text: '', status: 'streaming', at: 20 },
    ])

    expect(
      finishMessage(
        db,
        'assistant-1',
        'Hi there',
        'Considered the greeting.',
        'complete',
        30,
        'responses',
        'openai',
        [{ type: 'message', role: 'assistant' }],
      ),
    ).toEqual({
      id: 'assistant-1',
      role: 'assistant',
      text: 'Hi there',
      reasoning: 'Considered the greeting.',
      status: 'complete',
      at: 20,
    })
    expect(find(db, 'chat-1')).toMatchObject({ updatedAt: 30 })
    expect(messageText(db, 'assistant-1')).toBe('Hi there')
    expect(history(db, 'chat-1')[1]).toMatchObject({
      providerApi: 'responses',
      providerId: 'openai',
      providerItems: [{ type: 'message', role: 'assistant' }],
      reasoning: 'Considered the greeting.',
    })
  })

  it('does not finish the same streaming message twice', () => {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    beginTurn(db, 'chat-1', 'Hello', 'user-1', 'assistant-1', 20)
    expect(finishMessage(db, 'assistant-1', 'partial', '', 'cancelled', 25)).toBeDefined()
    expect(finishMessage(db, 'assistant-1', 'late', '', 'complete', 30)).toBeUndefined()
    expect(find(db, 'chat-1')?.messages[1]?.text).toBe('partial')
  })

  it('recovers a streaming placeholder left by an interrupted process', () => {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    beginTurn(db, 'chat-1', 'Hello', 'user-1', 'assistant-1', 20)
    expect(recoverInterrupted(db)).toBe(1)
    expect(find(db, 'chat-1')?.messages[1]?.status).toBe('error')
  })

  it('skips malformed rows instead of trusting database values', () => {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    db.exec('PRAGMA ignore_check_constraints = ON')
    db.prepare('UPDATE conversations SET mode = ? WHERE id = ?').run('turbo', 'chat-1')
    expect(list(db)).toEqual([])
  })
})
