import { describe, expect, it } from 'vitest'
import { open } from './db.js'
import type { StoredAttachment } from './attachments.js'
import type { TokenUsage, ToolStep } from '../shared/types.js'
import {
  beginTurn,
  create,
  find,
  finishMessage,
  history,
  list,
  messageAction,
  recoverInterrupted,
  remove,
  restartMessage,
  retryConversation,
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
      { id: 'user-1', role: 'user', text: 'Hello', status: 'complete', at: 20, attachments: [] },
      { id: 'assistant-1', role: 'assistant', text: '', status: 'streaming', at: 20, attachments: [] },
    ])

    expect(
      finishMessage(
        db,
        'assistant-1',
        'Hi there',
        'Considered the greeting.',
        'complete',
        30,
        {
          providerApi: 'responses',
          providerId: 'openai',
          items: [{ type: 'message', role: 'assistant' }],
        },
      ),
    ).toEqual({
      id: 'assistant-1',
      role: 'assistant',
      text: 'Hi there',
      reasoning: 'Considered the greeting.',
      status: 'complete',
      at: 20,
      attachments: [],
    })
    expect(find(db, 'chat-1')).toMatchObject({ updatedAt: 30 })
    expect(history(db, 'chat-1', new Map())[1]).toMatchObject({
      providerApi: 'responses',
      providerId: 'openai',
      providerItems: [{ type: 'message', role: 'assistant' }],
      reasoning: 'Considered the greeting.',
    })
  })

  it('associates draft attachments and seeds an attachment-only title', () => {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    const bytes = new TextEncoder().encode('%PDF-1.7')
    db.prepare(
      `INSERT INTO attachments
         (id, conversation_id, message_id, name, kind, media_type, byte_size, content, ordinal, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('file-1', 'chat-1', 'project-notes.pdf', 'pdf', 'application/pdf', bytes.byteLength, bytes, 0, 15)

    const turn = beginTurn(db, 'chat-1', '', 'user-1', 'assistant-1', 20, ['file-1'])

    expect(turn?.conversation.title).toBe('project-notes')
    expect(turn?.conversation.messages[0]?.attachments).toEqual([
      {
        id: 'file-1',
        name: 'project-notes.pdf',
        kind: 'pdf',
        mediaType: 'application/pdf',
        size: 8,
      },
    ])
    const attachmentMap = new Map<string, StoredAttachment[]>([
      [
        'user-1',
        [{ id: 'file-1', name: 'project-notes.pdf', kind: 'pdf', mediaType: 'application/pdf', size: 8, data: bytes }],
      ],
    ])
    expect(history(db, 'chat-1', attachmentMap)[0]?.attachments[0]?.data).toEqual(bytes)
  })

  it('does not finish the same streaming message twice', () => {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    beginTurn(db, 'chat-1', 'Hello', 'user-1', 'assistant-1', 20)
    expect(finishMessage(db, 'assistant-1', 'partial', '', 'cancelled', 25)).toBeDefined()
    expect(finishMessage(db, 'assistant-1', 'late', '', 'complete', 30)).toBeUndefined()
    expect(find(db, 'chat-1')?.messages[1]?.text).toBe('partial')
  })

  it('restarts only the latest failed or cancelled assistant message', () => {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    beginTurn(db, 'chat-1', 'Hello', 'user-1', 'assistant-1', 20)
    finishMessage(db, 'assistant-1', 'partial', 'unfinished', 'cancelled', 25)

    expect(messageAction(db, 'assistant-1')).toEqual({
      id: 'assistant-1',
      role: 'assistant',
      text: 'partial',
      status: 'cancelled',
      retryable: true,
    })
    expect(retryConversation(db, 'assistant-1')).toBe('chat-1')
    expect(restartMessage(db, 'assistant-1', 30)).toMatchObject({
      id: 'chat-1',
      updatedAt: 30,
      messages: [
        { id: 'user-1', status: 'complete' },
        { id: 'assistant-1', text: '', status: 'streaming' },
      ],
    })
    expect(retryConversation(db, 'assistant-1')).toBeUndefined()
  })

  it('does not retry a stopped response after a newer turn', () => {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    beginTurn(db, 'chat-1', 'First', 'user-1', 'assistant-1', 20)
    finishMessage(db, 'assistant-1', 'partial', '', 'error', 25)
    beginTurn(db, 'chat-1', 'Second', 'user-2', 'assistant-2', 30)
    finishMessage(db, 'assistant-2', 'done', '', 'complete', 35)

    expect(retryConversation(db, 'assistant-1')).toBeUndefined()
    expect(restartMessage(db, 'assistant-1', 40)).toBeUndefined()
    expect(messageAction(db, 'assistant-1')?.retryable).toBe(false)
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

describe('tool steps and usage', () => {
  const step: ToolStep = {
    callId: 'call-1',
    source: 'builtin',
    name: 'luna_echo',
    arguments: '{"text":"hi"}',
    text: 'hi',
    isError: false,
    truncated: false,
  }

  function turn(): ReturnType<typeof open> {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    beginTurn(db, 'chat-1', 'Hello', 'user-1', 'assistant-1', 20)
    return db
  }

  it('round-trips a tool step and its token usage', () => {
    const db = turn()
    const usage: TokenUsage = { inputTokens: 120, outputTokens: 40, reasoningTokens: 8 }
    const message = finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, {
      toolSteps: [step],
      usage,
    })

    expect(message?.toolSteps).toEqual([step])
    expect(message?.usage).toEqual(usage)
    expect(find(db, 'chat-1')?.messages[1]).toMatchObject({ toolSteps: [step], usage })
  })

  it('stores non-text result parts as references rather than bytes', () => {
    const db = turn()
    const withParts: ToolStep = {
      ...step,
      text: 'A chart.',
      parts: [
        { kind: 'image', mediaType: 'image/png', size: 20_480 },
        { kind: 'resource_link', uri: 'file:///project/report.csv' },
      ],
    }
    finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, { toolSteps: [withParts] })

    const stored = find(db, 'chat-1')?.messages[1]?.toolSteps?.[0]
    expect(stored).toEqual(withParts)
    // The bytes themselves never reach the row.
    expect(JSON.stringify(stored)).not.toContain('data:')
  })

  it('keeps structured content whole, including an explicit null', () => {
    const db = turn()
    const structured: ToolStep = { ...step, structured: { temperature: 22.5, ok: null } }
    finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, { toolSteps: [structured] })

    expect(find(db, 'chat-1')?.messages[1]?.toolSteps?.[0]?.structured).toEqual({
      temperature: 22.5,
      ok: null,
    })
  })

  it('round-trips a tool-reported failure so the model can be told about it', () => {
    const db = turn()
    const failed: ToolStep = { ...step, text: 'Date must be in the future.', isError: true }
    finishMessage(db, 'assistant-1', '', '', 'complete', 30, { toolSteps: [failed] })

    expect(find(db, 'chat-1')?.messages[1]?.toolSteps?.[0]?.isError).toBe(true)
  })

  /**
   * Replaying a call without its result, or a result without its call, is a hard
   * 400 from both provider APIs. Dropping just the bad entry would produce
   * exactly that, so the column has to fail as a unit.
   */
  it('drops the whole column when one step is unreadable', () => {
    const db = turn()
    finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, { toolSteps: [step] })
    db.prepare('UPDATE messages SET tool_steps = ? WHERE id = ?').run(
      JSON.stringify([step, { callId: 'call-2', source: 'builtin' }]),
      'assistant-1',
    )

    expect(find(db, 'chat-1')?.messages[1]?.toolSteps).toBeUndefined()
  })

  it('reads no usage at all rather than inventing zeros', () => {
    const db = turn()
    finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30)

    expect(find(db, 'chat-1')?.messages[1]?.usage).toBeUndefined()
  })

  it('reports a partial usage block without filling in the missing counts', () => {
    const db = turn()
    finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, {
      usage: { outputTokens: 12 },
    })

    expect(find(db, 'chat-1')?.messages[1]?.usage).toEqual({ outputTokens: 12 })
  })

  it('clears tool steps and usage when a failed turn is retried', () => {
    const db = turn()
    finishMessage(db, 'assistant-1', 'partial', '', 'error', 30, {
      toolSteps: [step],
      usage: { inputTokens: 120 },
    })

    const restarted = restartMessage(db, 'assistant-1', 40)

    expect(restarted?.messages[1]).toMatchObject({ status: 'streaming' })
    expect(restarted?.messages[1]?.toolSteps).toBeUndefined()
    expect(restarted?.messages[1]?.usage).toBeUndefined()
  })

  it('keeps tool steps and partial usage on a turn that failed after running tools', () => {
    const db = turn()
    const message = finishMessage(db, 'assistant-1', 'partial', '', 'error', 30, {
      toolSteps: [step],
      usage: { inputTokens: 120 },
    })

    expect(message?.toolSteps).toEqual([step])
    expect(message?.usage).toEqual({ inputTokens: 120 })
  })
})
