import { describe, expect, it } from 'vitest'
import { open } from './db.js'
import type { StoredAttachment } from './attachments.js'
import type { TokenUsage, ToolStep } from '../shared/types.js'
import {
  beginTurn,
  create,
  excerptAround,
  find,
  finishMessage,
  history,
  list,
  messageAction,
  messagesFor,
  recoverInterrupted,
  remove,
  restartMessage,
  retryConversation,
  searchChats,
  setDraft,
  setMode,
  setPinned,
  setTitle,
  summaries,
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

describe('tool rounds and usage', () => {
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

  it('round-trips ordered tool rounds and token usage', () => {
    const db = turn()
    const usage: TokenUsage = { inputTokens: 120, outputTokens: 40, reasoningTokens: 8 }
    const storedRounds = [
      {
        text: 'Let me check.',
        steps: [step],
        providerItems: [
          { type: 'reasoning', encrypted_content: 'encrypted-test-value' },
          { type: 'function_call', call_id: 'call-1', name: 'luna_echo' },
        ],
      },
      {
        text: 'One more check.',
        steps: [{ ...step, callId: 'call-2', arguments: '{"text":"again"}', text: 'again' }],
      },
    ]
    const message = finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, {
      toolRounds: storedRounds,
      usage,
    })

    expect(message?.toolRounds).toEqual(
      storedRounds.map((round) => ({ text: round.text, steps: round.steps })),
    )
    expect(message?.usage).toEqual(usage)
    expect(find(db, 'chat-1')?.messages[1]?.toolRounds?.[0]).not.toHaveProperty('providerItems')
    expect(history(db, 'chat-1', new Map())[1]?.toolRounds).toEqual(storedRounds)
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
    finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, {
      toolRounds: [{ text: '', steps: [withParts] }],
    })

    const stored = find(db, 'chat-1')?.messages[1]?.toolRounds?.[0]?.steps[0]
    expect(stored).toEqual(withParts)
    // The bytes themselves never reach the row.
    expect(JSON.stringify(stored)).not.toContain('data:')
  })

  it('keeps structured content whole, including an explicit null', () => {
    const db = turn()
    const structured: ToolStep = { ...step, structured: { temperature: 22.5, ok: null } }
    finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, {
      toolRounds: [{ text: '', steps: [structured] }],
    })

    expect(find(db, 'chat-1')?.messages[1]?.toolRounds?.[0]?.steps[0]?.structured).toEqual({
      temperature: 22.5,
      ok: null,
    })
  })

  it('round-trips a tool-reported failure so the model can be told about it', () => {
    const db = turn()
    const failed: ToolStep = { ...step, text: 'Date must be in the future.', isError: true }
    finishMessage(db, 'assistant-1', '', '', 'complete', 30, {
      toolRounds: [{ text: '', steps: [failed] }],
    })

    expect(find(db, 'chat-1')?.messages[1]?.toolRounds?.[0]?.steps[0]?.isError).toBe(true)
  })

  /**
   * Replaying a call without its result, or a result without its call, is a hard
   * 400 from both provider APIs. Dropping just the bad entry would produce
   * exactly that, so the column has to fail as a unit.
   */
  it('drops the whole column when one round is unreadable', () => {
    const db = turn()
    finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, {
      toolRounds: [{ text: 'Checking.', steps: [step] }],
    })
    db.prepare('UPDATE messages SET tool_steps = ? WHERE id = ?').run(
      JSON.stringify([
        { text: 'Checking.', steps: [step] },
        { text: 'Broken.', steps: [{ callId: 'call-2', source: 'builtin' }] },
      ]),
      'assistant-1',
    )

    expect(find(db, 'chat-1')?.messages[1]?.toolRounds).toBeUndefined()
  })

  it('treats the unshipped flat step shape as unreadable history', () => {
    const db = turn()
    db.prepare('UPDATE messages SET tool_steps = ? WHERE id = ?').run(
      JSON.stringify([step]),
      'assistant-1',
    )

    expect(find(db, 'chat-1')?.messages[1]?.toolRounds).toBeUndefined()
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

  it('drops invalid counts instead of failing the terminal message write', () => {
    const db = turn()
    expect(() =>
      finishMessage(db, 'assistant-1', 'Done', '', 'complete', 30, {
        usage: { inputTokens: 1.5, outputTokens: Number.NaN },
      }),
    ).not.toThrow()

    expect(find(db, 'chat-1')?.messages[1]).toMatchObject({ status: 'complete' })
    expect(find(db, 'chat-1')?.messages[1]?.usage).toBeUndefined()
  })

  it('clears tool rounds and usage when a failed turn is retried', () => {
    const db = turn()
    finishMessage(db, 'assistant-1', 'partial', '', 'error', 30, {
      toolRounds: [{ text: 'Checking.', steps: [step] }],
      usage: { inputTokens: 120 },
    })

    const restarted = restartMessage(db, 'assistant-1', 40)

    expect(restarted?.messages[1]).toMatchObject({ status: 'streaming' })
    expect(restarted?.messages[1]?.toolRounds).toBeUndefined()
    expect(restarted?.messages[1]?.usage).toBeUndefined()
  })

  it('keeps tool rounds and partial usage on a turn that failed after running tools', () => {
    const db = turn()
    const message = finishMessage(db, 'assistant-1', 'partial', '', 'error', 30, {
      toolRounds: [{ text: 'Checking.', steps: [step] }],
      usage: { inputTokens: 120 },
    })

    expect(message?.toolRounds).toEqual([{ text: 'Checking.', steps: [step] }])
    expect(message?.usage).toEqual({ inputTokens: 120 })
  })
})

describe('summaries and per-conversation loading', () => {
  function seeded(): ReturnType<typeof open> {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    create(db, 'chat-2', 'expert', 20)
    beginTurn(db, 'chat-1', 'Hello there', 'user-1', 'assistant-1', 30)
    finishMessage(db, 'assistant-1', 'General Kenobi', '', 'complete', 40)
    beginTurn(db, 'chat-2', 'Second chat', 'user-2', 'assistant-2', 50)
    finishMessage(db, 'assistant-2', 'Second reply', 'thinking aloud', 'complete', 60)
    return db
  }

  /** The sidebar cost must not scale with how much history exists. */
  it('lists conversations without their messages', () => {
    const listed = summaries(seeded())

    expect(listed).toHaveLength(2)
    for (const entry of listed) expect(entry).not.toHaveProperty('messages')
    expect(listed.map((entry) => entry.id)).toEqual(['chat-2', 'chat-1'])
  })

  it('loads the messages of one conversation only', () => {
    const db = seeded()
    const loaded = messagesFor(db, 'chat-1')

    expect(loaded.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
    expect(loaded[1]?.text).toBe('General Kenobi')
  })

  it('returns nothing for a conversation with no messages', () => {
    const db = open(':memory:')
    create(db, 'empty', 'fast', 10)
    expect(messagesFor(db, 'empty')).toEqual([])
  })

  it('strips main-only replay data before the messages leave storage', () => {
    const db = seeded()
    finishMessage(db, 'assistant-1', 'Answer', '', 'complete', 70, {
      providerApi: 'responses',
      providerId: 'openai',
      items: [{ type: 'message' }],
    })
    const loaded = messagesFor(db, 'chat-1')

    for (const message of loaded) {
      expect(message).not.toHaveProperty('providerItems')
      expect(message).not.toHaveProperty('providerId')
    }
  })
})

describe('searchChats', () => {
  function corpus(): ReturnType<typeof open> {
    const db = open(':memory:')
    create(db, 'chat-1', 'fast', 10)
    setTitle(db, 'chat-1', 'Weekend trip')
    beginTurn(db, 'chat-1', 'Where should we go?', 'user-1', 'assistant-1', 20)
    finishMessage(db, 'assistant-1', 'The coast is lovely in autumn.', '', 'complete', 30)

    create(db, 'chat-2', 'fast', 40)
    setTitle(db, 'chat-2', 'Dinner ideas')
    beginTurn(db, 'chat-2', 'Something quick', 'user-2', 'assistant-2', 50)
    finishMessage(db, 'assistant-2', 'Try a sheet pan supper.', 'weighing options', 'complete', 60)
    return db
  }

  it('finds a conversation by message text and shows where it matched', () => {
    const hits = searchChats(corpus(), 'coast')

    expect(hits).toHaveLength(1)
    expect(hits[0]?.conversation.title).toBe('Weekend trip')
    expect(hits[0]?.excerpt).toContain('coast')
  })

  it('finds a conversation by title even with no message match', () => {
    const hits = searchChats(corpus(), 'Dinner')
    expect(hits.map((hit) => hit.conversation.id)).toEqual(['chat-2'])
  })

  it('searches reasoning as well as answer text', () => {
    const hits = searchChats(corpus(), 'weighing')
    expect(hits.map((hit) => hit.conversation.id)).toEqual(['chat-2'])
  })

  it('is case insensitive', () => {
    expect(searchChats(corpus(), 'COAST')).toHaveLength(1)
  })

  it('returns nothing for an empty query', () => {
    expect(searchChats(corpus(), '   ')).toEqual([])
  })

  /** A percent sign is a LIKE wildcard, so an unescaped one matches everything. */
  it('treats LIKE wildcards as literal characters', () => {
    expect(searchChats(corpus(), '%')).toEqual([])
    expect(searchChats(corpus(), '_')).toEqual([])
  })

  it('orders results pinned first, then newest', () => {
    const db = corpus()
    setPinned(db, 'chat-1', true)
    const hits = searchChats(db, 'e')
    expect(hits[0]?.conversation.id).toBe('chat-1')
  })

  it('carries no message bodies in a result', () => {
    const hits = searchChats(corpus(), 'coast')
    expect(hits[0]?.conversation).not.toHaveProperty('messages')
  })
})

describe('excerptAround', () => {
  it('returns short text whole', () => {
    expect(excerptAround('the coast is lovely', 'coast')).toBe('the coast is lovely')
  })

  it('windows a long line around the match with ellipses', () => {
    const long = `${'a'.repeat(200)} needle ${'b'.repeat(200)}`
    const excerpt = excerptAround(long, 'needle')
    expect(excerpt).toContain('needle')
    expect(excerpt?.startsWith('…')).toBe(true)
    expect(excerpt?.endsWith('…')).toBe(true)
  })

  it('collapses whitespace so an excerpt stays on one line', () => {
    expect(excerptAround('a\n\n  b   coast', 'coast')).toBe('a b coast')
  })

  it('reports nothing when the text does not match', () => {
    expect(excerptAround('nothing here', 'coast')).toBeUndefined()
  })
})
