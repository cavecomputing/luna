import { describe, expect, it, vi } from 'vitest'
import type { Prefs } from '../../shared/prefs.js'
import type { Result } from '../../shared/result.js'
import type { Conversation, Message, MessageStatus } from '../../shared/types.js'
import type { ChatChunk, ChatCompletion, ChatRequest } from '../chat-api.js'
import type { ProviderConfig } from '../providers.js'
import { ChatCoordinator } from './chat.js'

const conversation: Conversation = {
  id: 'chat-1',
  title: 'New chat',
  draft: '',
  icon: 'spark',
  mode: 'fast',
  pinned: false,
  updatedAt: 1,
  messages: [],
}

const provider: ProviderConfig = {
  id: 'provider-1',
  name: 'Provider',
  baseUrl: 'https://example.com/v1',
  api: 'responses',
  organization: '',
  project: '',
}

const preferences: Prefs = {
  theme: 'light',
  defaultMode: 'fast',
  autoTitle: false,
  stream: true,
  systemPrompt: 'Be helpful.',
}

type TestDeps = ConstructorParameters<typeof ChatCoordinator>[0]

function assistant(status: Message['status'], text: string, reasoning = ''): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    text,
    ...(reasoning === '' ? {} : { reasoning }),
    status,
    at: 10,
    attachments: [],
  }
}

function makeDeps(): TestDeps {
  let ids = 0
  return {
    getChat: vi.fn((id: string) => (id === conversation.id ? conversation : undefined)),
    slots: vi.fn(() => ({
      fast: { providerId: provider.id, model: 'model-fast' },
      expert: { providerId: provider.id, model: 'model-expert' },
    })),
    getProvider: vi.fn((id: string) => (id === provider.id ? provider : undefined)),
    readKey: vi.fn(() => Promise.resolve('secret')),
    prefs: vi.fn(() => preferences),
    begin: vi.fn((_id: string, text: string, userId: string, assistantId: string) => ({
      conversation: {
        ...conversation,
        messages: [
          { id: userId, role: 'user' as const, text, status: 'complete' as const, at: 10, attachments: [] },
          { id: assistantId, role: 'assistant' as const, text: '', status: 'streaming' as const, at: 10, attachments: [] },
        ],
      },
      userMessageId: userId,
      assistantMessageId: assistantId,
    })),
    retryTarget: vi.fn((id: string) => (id === 'assistant-1' ? 'chat-1' : undefined)),
    restart: vi.fn((id: string) =>
      id === 'assistant-1'
        ? {
            ...conversation,
            messages: [
              { id: 'user-1', role: 'user' as const, text: 'Hello', status: 'complete' as const, at: 10, attachments: [] },
              { id, role: 'assistant' as const, text: '', status: 'streaming' as const, at: 10, attachments: [] },
            ],
          }
        : undefined,
    ),
    history: vi.fn(() => Promise.resolve([
      { id: 'user-1', role: 'user' as const, text: 'Hello', status: 'complete' as const, at: 10, attachments: [] },
      { id: 'assistant-1', role: 'assistant' as const, text: '', status: 'streaming' as const, at: 10, attachments: [] },
    ])),
    finish: vi.fn(
      (
        _id: string,
        text: string,
        reasoning: string,
        status: Exclude<MessageStatus, 'streaming'>,
      ) => assistant(status, text, reasoning),
    ),
    setTitle: vi.fn((id: string, title: string) =>
      id === conversation.id ? { ...conversation, title } : undefined,
    ),
    list: vi.fn(() => [conversation]),
    stream: vi.fn((_request: ChatRequest, _signal: AbortSignal, onDelta: (chunk: ChatChunk) => void) => {
      onDelta({ text: 'Hel', reasoning: '' })
      onDelta({ text: 'Hello', reasoning: '' })
      return Promise.resolve({ ok: true as const, value: { text: 'Hello', reasoning: '' } })
    }),
    newId: vi.fn(() => `${++ids === 1 ? 'user' : 'assistant'}-1`),
    now: vi.fn(() => 10),
    notifyChats: vi.fn(),
    notifyDelta: vi.fn(),
    notifyDone: vi.fn(),
    notifyError: vi.fn(),
  }
}

describe('ChatCoordinator', () => {
  it('starts a persisted turn and publishes streaming completion', async () => {
    const d = makeDeps()
    const chat = new ChatCoordinator(d)
    expect(await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })).toMatchObject({
      ok: true,
      value: { userMessageId: 'user-1', assistantMessageId: 'assistant-1' },
    })
    await vi.waitFor(() => {
      expect(d.notifyDone).toHaveBeenCalledWith('chat-1', assistant('complete', 'Hello'))
    })
    expect(d.notifyDelta).toHaveBeenNthCalledWith(1, {
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      text: 'Hel',
      reasoning: '',
      seq: 1,
    })
    expect(d.finish).toHaveBeenCalledWith(
      'assistant-1',
      'Hello',
      '',
      'complete',
      10,
      'responses',
      'provider-1',
      undefined,
    )
  })

  it('accepts an attachment-only turn and passes selected draft ids atomically', async () => {
    const d = makeDeps()
    const chat = new ChatCoordinator(d)
    expect(
      await chat.send({ conversationId: 'chat-1', text: '', attachmentIds: ['file-1'] }),
    ).toMatchObject({ ok: true })
    expect(d.begin).toHaveBeenCalledWith(
      'chat-1',
      '',
      'user-1',
      'assistant-1',
      10,
      ['file-1'],
    )
  })

  it('separates thinking tags even when they are split across streamed deltas', async () => {
    const d = makeDeps()
    d.stream = vi.fn(
      (_request: ChatRequest, _signal: AbortSignal, onDelta: (chunk: ChatChunk) => void) => {
        onDelta({ text: '<thi', reasoning: '' })
        onDelta({ text: '<think>checking</thi', reasoning: '' })
        onDelta({ text: '<think>checking</think>Answer', reasoning: '' })
        return Promise.resolve({
          ok: true as const,
          value: { text: '<think>checking</think>Answer', reasoning: '' },
        })
      },
    )
    await new ChatCoordinator(d).send({ conversationId: 'chat-1', text: 'Question', attachmentIds: [] })
    await vi.waitFor(() => {
      expect(d.notifyDone).toHaveBeenCalledWith(
        'chat-1',
        assistant('complete', 'Answer', 'checking'),
      )
    })
    expect(d.notifyDelta).toHaveBeenNthCalledWith(2, {
      conversationId: 'chat-1',
      messageId: 'assistant-1',
      text: '',
      reasoning: 'checking',
      seq: 2,
    })
    expect(d.finish).toHaveBeenCalledWith(
      'assistant-1',
      'Answer',
      'checking',
      'complete',
      10,
      'responses',
      'provider-1',
      undefined,
    )
  })

  it('combines structured provider reasoning with thinking tags', async () => {
    const d = makeDeps()
    d.stream = vi.fn(
      (_request: ChatRequest, _signal: AbortSignal, onDelta: (chunk: ChatChunk) => void) => {
        onDelta({ text: '<think>tagged</think>Answer', reasoning: 'structured' })
        return Promise.resolve({
          ok: true as const,
          value: { text: '<think>tagged</think>Answer', reasoning: 'structured' },
        })
      },
    )
    await new ChatCoordinator(d).send({ conversationId: 'chat-1', text: 'Question', attachmentIds: [] })
    await vi.waitFor(() => {
      expect(d.notifyDone).toHaveBeenCalledWith(
        'chat-1',
        assistant('complete', 'Answer', 'structured\n\ntagged'),
      )
    })
  })

  it('persists and publishes a mid-stream error', async () => {
    const d = makeDeps()
    d.stream = vi.fn((_request: ChatRequest, _signal: AbortSignal, onDelta: (chunk: ChatChunk) => void) => {
      onDelta({ text: 'partial', reasoning: '' })
      return Promise.resolve({ ok: false as const, code: 'chat/provider', message: 'failed' })
    })
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })
    await vi.waitFor(() => {
      expect(d.notifyError).toHaveBeenCalledWith(
        'chat-1',
        assistant('error', 'partial'),
        'chat/provider',
      )
    })
  })

  it('aborts an active message and stores the partial reply as cancelled', async () => {
    const d = makeDeps()
    d.stream = vi.fn((_request: ChatRequest, signal: AbortSignal, onDelta: (chunk: ChatChunk) => void) =>
      new Promise<Result<ChatCompletion>>((resolve) => {
        onDelta({ text: 'partial', reasoning: '' })
        signal.addEventListener('abort', () => {
          resolve({ ok: false, code: 'chat/cancelled', message: 'cancelled' })
        })
      }),
    )
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })
    expect(chat.cancel({ messageId: 'assistant-1' })).toEqual({ ok: true, value: undefined })
    await vi.waitFor(() => {
      expect(d.notifyDone).toHaveBeenCalledWith(
        'chat-1',
        assistant('cancelled', 'partial'),
      )
    })
  })

  it('rejects a second request while the conversation is streaming', async () => {
    const d = makeDeps()
    d.stream = vi.fn(
      () => new Promise<Result<ChatCompletion>>((resolve) => { void resolve }),
    )
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'First', attachmentIds: [] })
    expect(await chat.send({ conversationId: 'chat-1', text: 'Second', attachmentIds: [] })).toMatchObject({
      ok: false,
      code: 'chat/busy',
    })
    chat.stopAll()
  })

  it('retries the latest stopped response without adding another user message', async () => {
    const d = makeDeps()
    const chat = new ChatCoordinator(d)
    expect(await chat.retry({ messageId: 'assistant-1' })).toEqual({
      ok: true,
      value: undefined,
    })
    await vi.waitFor(() => {
      expect(d.notifyDone).toHaveBeenCalledWith('chat-1', assistant('complete', 'Hello'))
    })
    expect(d.restart).toHaveBeenCalledWith('assistant-1', 10)
    expect(d.begin).not.toHaveBeenCalled()
    expect(d.stream).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'model-fast' }),
      expect.any(AbortSignal),
      expect.any(Function),
    )
  })

  it('rejects a response that is no longer retryable', async () => {
    const d = makeDeps()
    d.retryTarget = vi.fn(() => undefined)
    expect(await new ChatCoordinator(d).retry({ messageId: 'assistant-1' })).toMatchObject({
      ok: false,
      code: 'chat/not-retryable',
    })
    expect(d.restart).not.toHaveBeenCalled()
    expect(d.stream).not.toHaveBeenCalled()
  })

  it.each([
    [{ conversationId: '../bad', text: 'Hello', attachmentIds: [] }, 'chat/invalid'],
    [{ conversationId: 'missing', text: 'Hello', attachmentIds: [] }, 'chat/missing'],
    [{ conversationId: 'chat-1', text: '   ', attachmentIds: [] }, 'chat/invalid'],
    [{ conversationId: 'chat-1', text: '', attachmentIds: ['../bad'] }, 'chat/invalid'],
  ])('returns a stable error for invalid input', async (input, code) => {
    const chat = new ChatCoordinator(makeDeps())
    expect(await chat.send(input)).toMatchObject({ ok: false, code })
  })

  it('reports unconfigured model slots before writing a message', async () => {
    const d = makeDeps()
    d.slots = vi.fn(() => ({
      fast: { providerId: provider.id, model: '' },
      expert: { providerId: null, model: '' },
    }))
    expect(
      await new ChatCoordinator(d).send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] }),
    ).toMatchObject({ ok: false, code: 'chat/no-model' })
    expect(d.begin).not.toHaveBeenCalled()
  })

  it('uses the Fast model to name a completed first exchange', async () => {
    const d = makeDeps()
    d.prefs = vi.fn(() => ({ ...preferences, autoTitle: true }))
    let calls = 0
    d.stream = vi.fn(
      (_request: ChatRequest, _signal: AbortSignal, onDelta: (chunk: ChatChunk) => void) => {
        calls += 1
        if (calls === 1) {
          onDelta({ text: 'Answer', reasoning: '' })
          return Promise.resolve({ ok: true as const, value: { text: 'Answer', reasoning: '' } })
        }
        return Promise.resolve({ ok: true as const, value: { text: 'Helpful Greeting', reasoning: '' } })
      },
    )
    await new ChatCoordinator(d).send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })
    await vi.waitFor(() => {
      expect(d.setTitle).toHaveBeenCalledWith('chat-1', 'Helpful Greeting')
    })
    expect(d.stream).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'model-fast' }),
      expect.any(AbortSignal),
      expect.any(Function),
    )
  })
})
