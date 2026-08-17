import { describe, expect, it, vi } from 'vitest'
import type { Prefs } from '../../shared/prefs.js'
import type { Result } from '../../shared/result.js'
import type { Conversation, Message, MessageStatus } from '../../shared/types.js'
import { defaultSamplerSettings } from '../../shared/types.js'
import type { ChatChunk, ChatCompletion, ChatRequest } from '../chat-api.js'
import type { ProviderConfig } from '../providers.js'
import { LUNA_SYSTEM_PROMPT } from '../system-prompt.js'
import { ChatCoordinator } from './chat.js'
import { MAX_TOOL_ITERATIONS, type ToolInfo } from '../../shared/tools.js'
import type { ToolStep } from '../../shared/types.js'
import type { ToolCall } from '../tools/registry.js'
import type { ToolOutcome } from '../tools/result.js'

const conversation: Conversation = {
  id: 'chat-1',
  title: 'New chat',
  draft: '',
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
  theme: 'luna-light',
  defaultMode: 'fast',
  autoTitle: false,
  stream: true,
  expandThinking: false,
  sidebarWidth: 264,
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
      fast: { providerId: provider.id, model: 'model-fast', sampling: { ...defaultSamplerSettings } },
      expert: { providerId: provider.id, model: 'model-expert', sampling: { ...defaultSamplerSettings } },
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
    // No tools enabled by default, so an ordinary turn is a single request.
    toolCatalog: vi.fn().mockResolvedValue([]),
    callTool: vi.fn(),
    approve: vi.fn().mockResolvedValue('deny'),
    allowAlways: vi.fn(),
    newId: vi.fn(() => `${++ids === 1 ? 'user' : 'assistant'}-1`),
    now: vi.fn(() => 10),
    notifyChats: vi.fn(),
    notifyDelta: vi.fn(),
    notifyDone: vi.fn(),
    notifyError: vi.fn(),
  }
}

describe('ChatCoordinator', () => {
  it('settles only after an aborted turn has finished writing', async () => {
    const d = makeDeps()
    let release = (): void => undefined
    let started = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const streaming = new Promise<void>((resolve) => {
      started = resolve
    })
    d.stream = vi.fn(async () => {
      started()
      await held
      return { ok: false as const, code: 'chat/cancelled', message: 'aborted' }
    })
    const chat = new ChatCoordinator(d)
    expect(await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })).toMatchObject({ ok: true })

    // The request has to be in flight for this to test the settle barrier at
    // all; a turn stopped before it starts has nothing left to unwind.
    await streaming
    chat.stopAll()
    let settled = false
    void chat.settle().then(() => {
      settled = true
    })
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()

    // Aborting only starts the unwind. While the turn is still in flight the
    // terminal row is unwritten, and settle must not let a caller close the
    // database out from under it.
    expect(settled).toBe(false)
    expect(d.finish).not.toHaveBeenCalled()

    release()
    await chat.settle()
    // The trailing outcome carries tool rounds and usage; a turn that ran
    // neither still passes it, empty.
    expect(d.finish).toHaveBeenCalledWith('assistant-1', '', '', 'cancelled', 10, {})
  })

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
      { providerApi: 'responses', providerId: 'provider-1' },
    )
    expect(d.stream).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: LUNA_SYSTEM_PROMPT }),
      expect.any(AbortSignal),
      expect.any(Function),
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
      { providerApi: 'responses', providerId: 'provider-1' },
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
    let started = (): void => undefined
    const streaming = new Promise<void>((resolve) => {
      started = resolve
    })
    d.stream = vi.fn((_request: ChatRequest, signal: AbortSignal, onDelta: (chunk: ChatChunk) => void) =>
      new Promise<Result<ChatCompletion>>((resolve) => {
        onDelta({ text: 'partial', reasoning: '' })
        started()
        signal.addEventListener('abort', () => {
          resolve({ ok: false, code: 'chat/cancelled', message: 'cancelled' })
        })
      }),
    )
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })
    await streaming
    expect(chat.cancel({ messageId: 'assistant-1' })).toEqual({ ok: true, value: undefined })
    await vi.waitFor(() => {
      expect(d.notifyDone).toHaveBeenCalledWith(
        'chat-1',
        assistant('cancelled', 'partial'),
      )
    })
  })

  /**
   * Stopping before the first request goes out should cost nothing. The turn
   * still lands in exactly one terminal state, but no provider call is made.
   */
  it('never contacts the provider when the turn is stopped before it starts', async () => {
    const d = makeDeps()
    d.toolCatalog = vi.fn(async (signal: AbortSignal) => {
      // Stand in for any awaited setup the user can cancel during.
      await Promise.resolve()
      expect(signal.aborted).toBe(true)
      return []
    })
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })
    chat.stopAll()

    await vi.waitFor(() => {
      expect(d.notifyDone).toHaveBeenCalledWith('chat-1', assistant('cancelled', ''))
    })
    expect(d.stream).not.toHaveBeenCalled()
    expect(d.finish).toHaveBeenCalledTimes(1)
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
      fast: { providerId: provider.id, model: '', sampling: { ...defaultSamplerSettings } },
      expert: { providerId: null, model: '', sampling: { ...defaultSamplerSettings } },
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

describe('tool loop', () => {
  const echo: ToolInfo = {
    source: 'builtin',
    sourceLabel: 'Luna',
    definition: { name: 'luna_echo', description: 'Echoes.', inputSchema: { type: 'object' } },
    enabled: true,
    policy: 'ask',
    standing: 'known',
  }

  function step(over: Partial<ToolStep> = {}): ToolStep {
    return {
      callId: 'call-1',
      source: 'builtin',
      name: 'luna_echo',
      arguments: '{}',
      text: 'tool said hi',
      isError: false,
      truncated: false,
      ...over,
    }
  }

  /** Replies with tool calls on the listed rounds, then a plain answer. */
  function scripted(
    rounds: { text: string; calls?: { callId: string; name: string; arguments: string }[] }[],
  ) {
    let round = 0
    return vi.fn(
      (_request: ChatRequest, _signal: AbortSignal, onDelta: (chunk: ChatChunk) => void) => {
        const script = rounds[Math.min(round, rounds.length - 1)]
        round += 1
        onDelta({ text: script?.text ?? '', reasoning: '' })
        return Promise.resolve<Result<ChatCompletion>>({
          ok: true,
          value: {
            text: script?.text ?? '',
            reasoning: '',
            ...(script?.calls === undefined ? {} : { toolCalls: script.calls }),
          },
        })
      },
    )
  }

  function withTools(): TestDeps {
    const d = makeDeps()
    d.toolCatalog = vi.fn().mockResolvedValue([{ ...echo, policy: 'allow' }])
    d.callTool = vi.fn().mockResolvedValue({ modelText: 'tool said hi', step: step() })
    return d
  }

  it('feeds a tool result back and finishes on the second reply', async () => {
    const d = withTools()
    d.stream = scripted([
      { text: 'Checking.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
      { text: 'All done.' },
    ])
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

    await vi.waitFor(() => {
      expect(d.finish).toHaveBeenCalledTimes(1)
    })
    expect(d.stream).toHaveBeenCalledTimes(2)
    expect(d.finish).toHaveBeenCalledWith(
      'assistant-1',
      'Checking.\n\nAll done.',
      '',
      'complete',
      10,
      expect.objectContaining({
        toolRounds: [expect.objectContaining({ text: 'Checking.', steps: [step()] })],
      }),
    )
  })

  it('makes exactly one request when the model asks for no tools', async () => {
    const d = withTools()
    d.stream = scripted([{ text: 'Straight answer.' }])
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

    await vi.waitFor(() => {
      expect(d.finish).toHaveBeenCalledTimes(1)
    })
    expect(d.stream).toHaveBeenCalledTimes(1)
    expect(d.callTool).not.toHaveBeenCalled()
  })

  /**
   * streamSeq is the renderer's ordering guard. Resetting it per round would
   * make the second round's reply look stale and get discarded.
   */
  it('keeps the delta sequence monotonic across rounds', async () => {
    const d = withTools()
    d.stream = scripted([
      { text: 'One.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
      { text: 'Two.' },
    ])
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

    await vi.waitFor(() => {
      expect(d.finish).toHaveBeenCalledTimes(1)
    })
    const seqs = (d.notifyDelta as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { seq: number }).seq,
    )
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('accumulates text from every round into the final answer', async () => {
    const d = withTools()
    d.stream = scripted([
      { text: 'First.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
      { text: 'Second.', calls: [{ callId: 'call-2', name: 'luna_echo', arguments: '{}' }] },
      { text: 'Third.' },
    ])
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

    await vi.waitFor(() => {
      expect(d.finish).toHaveBeenCalledTimes(1)
    })
    expect((d.finish as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe(
      'First.\n\nSecond.\n\nThird.',
    )
  })

  it('stops at the iteration cap and writes one error row', async () => {
    const d = withTools()
    d.stream = scripted([
      { text: 'Again.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
    ])
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

    await vi.waitFor(() => {
      expect(d.finish).toHaveBeenCalledTimes(1)
    })
    expect(d.stream).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS)
    expect(d.notifyError).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ status: 'error' }),
      'chat/tool-loop-limit',
    )
  })

  it('records the rounds it completed when a later round fails', async () => {
    const d = withTools()
    let round = 0
    d.stream = vi.fn(() => {
      round += 1
      if (round === 1) {
        return Promise.resolve<Result<ChatCompletion>>({
          ok: true,
          value: {
            text: 'Trying.',
            reasoning: '',
            toolCalls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }],
          },
        })
      }
      return Promise.resolve<Result<ChatCompletion>>({
        ok: false,
        code: 'chat/provider',
        message: 'boom',
      })
    })
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

    await vi.waitFor(() => {
      expect(d.finish).toHaveBeenCalledTimes(1)
    })
    expect(d.finish).toHaveBeenCalledWith(
      'assistant-1',
      'Trying.',
      '',
      'error',
      10,
      expect.objectContaining({ toolRounds: [expect.objectContaining({ text: 'Trying.' })] }),
    )
  })

  it('sums usage across every round', async () => {
    const d = withTools()
    let round = 0
    d.stream = vi.fn(() => {
      round += 1
      return Promise.resolve<Result<ChatCompletion>>({
        ok: true,
        value: {
          text: `r${String(round)}`,
          reasoning: '',
          usage: { inputTokens: 100, outputTokens: 10 },
          ...(round === 1
            ? { toolCalls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] }
            : {}),
        },
      })
    })
    const chat = new ChatCoordinator(d)
    await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

    await vi.waitFor(() => {
      expect(d.finish).toHaveBeenCalledTimes(1)
    })
    expect((d.finish as ReturnType<typeof vi.fn>).mock.calls[0]?.[5]).toMatchObject({
      usage: { inputTokens: 200, outputTokens: 20 },
    })
  })

  describe('consent', () => {
    it('asks before a tool with policy ask, and runs it when allowed once', async () => {
      const d = withTools()
      d.toolCatalog = vi.fn().mockResolvedValue([echo])
      d.approve = vi.fn().mockResolvedValue('once')
      d.stream = scripted([
        { text: 'Checking.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
        { text: 'Done.' },
      ])
      const chat = new ChatCoordinator(d)
      await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

      await vi.waitFor(() => {
        expect(d.finish).toHaveBeenCalledTimes(1)
      })
      expect(d.approve).toHaveBeenCalledTimes(1)
      expect(d.callTool).toHaveBeenCalledTimes(1)
      expect(d.allowAlways).not.toHaveBeenCalled()
    })

    it('persists standing permission only when the prompt says always', async () => {
      const d = withTools()
      d.toolCatalog = vi.fn().mockResolvedValue([echo])
      d.approve = vi.fn().mockResolvedValue('always')
      d.stream = scripted([
        { text: 'Checking.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
        { text: 'Done.' },
      ])
      const chat = new ChatCoordinator(d)
      await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

      await vi.waitFor(() => {
        expect(d.finish).toHaveBeenCalledTimes(1)
      })
      expect(d.allowAlways).toHaveBeenCalledWith('builtin', 'luna_echo', 10)
    })

    it('does not ask again for a tool that already has standing permission', async () => {
      const d = withTools()
      d.stream = scripted([
        { text: 'Checking.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
        { text: 'Done.' },
      ])
      const chat = new ChatCoordinator(d)
      await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

      await vi.waitFor(() => {
        expect(d.finish).toHaveBeenCalledTimes(1)
      })
      expect(d.approve).not.toHaveBeenCalled()
    })

    /** A refusal is something the model is told about, not a failed turn. */
    it('turns a denial into a tool error and keeps the turn going', async () => {
      const d = withTools()
      d.toolCatalog = vi.fn().mockResolvedValue([echo])
      d.approve = vi.fn().mockResolvedValue('deny')
      d.stream = scripted([
        { text: 'Checking.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
        { text: 'Understood.' },
      ])
      const chat = new ChatCoordinator(d)
      await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

      await vi.waitFor(() => {
        expect(d.finish).toHaveBeenCalledTimes(1)
      })
      expect(d.callTool).not.toHaveBeenCalled()
      expect(d.notifyDone).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({ status: 'complete' }),
      )
      const outcome = (d.finish as ReturnType<typeof vi.fn>).mock.calls[0]?.[5] as {
        toolRounds: { steps: ToolStep[] }[]
      }
      expect(outcome.toolRounds[0]?.steps[0]).toMatchObject({ isError: true })
    })

    /** A tool the user never enabled must not be reachable, even if asked for. */
    it('refuses a tool that is not in the snapshotted catalog', async () => {
      const d = withTools()
      d.stream = scripted([
        { text: 'Trying.', calls: [{ callId: 'call-1', name: 'not_enabled', arguments: '{}' }] },
        { text: 'Oh well.' },
      ])
      const chat = new ChatCoordinator(d)
      await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })

      await vi.waitFor(() => {
        expect(d.finish).toHaveBeenCalledTimes(1)
      })
      expect(d.callTool).not.toHaveBeenCalled()
      expect(d.approve).not.toHaveBeenCalled()
    })
  })

  describe('cancellation', () => {
    /**
     * Regression guard on moving active.delete into a finally. Before that, the
     * controller was deregistered the moment the first stream resolved, so Stop
     * during a tool call was a no-op.
     */
    it('can still be cancelled while a tool is running', async () => {
      const d = withTools()
      let started = (): void => undefined
      const running = new Promise<void>((resolve) => {
        started = resolve
      })
      d.callTool = vi.fn(
        (_source: string, _call: ToolCall, signal: AbortSignal) =>
          new Promise<ToolOutcome>((resolve) => {
            started()
            signal.addEventListener('abort', () => {
              resolve({ modelText: 'stopped', step: step({ isError: true }) })
            })
          }),
      )
      d.stream = scripted([
        { text: 'Working.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
        { text: 'Done.' },
      ])
      const chat = new ChatCoordinator(d)
      await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })
      await running

      expect(chat.cancel({ messageId: 'assistant-1' })).toEqual({ ok: true, value: undefined })
      await vi.waitFor(() => {
        expect(d.finish).toHaveBeenCalledTimes(1)
      })
      expect(d.notifyDone).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({ status: 'cancelled' }),
      )
    })

    it('does not start another round after being cancelled', async () => {
      const d = withTools()
      let started = (): void => undefined
      const running = new Promise<void>((resolve) => {
        started = resolve
      })
      d.callTool = vi.fn(
        (_source: string, _call: ToolCall, signal: AbortSignal) =>
          new Promise<ToolOutcome>((resolve) => {
            started()
            signal.addEventListener('abort', () => {
              resolve({ modelText: 'stopped', step: step({ isError: true }) })
            })
          }),
      )
      d.stream = scripted([
        { text: 'Working.', calls: [{ callId: 'call-1', name: 'luna_echo', arguments: '{}' }] },
        { text: 'Should never run.' },
      ])
      const chat = new ChatCoordinator(d)
      await chat.send({ conversationId: 'chat-1', text: 'Hello', attachmentIds: [] })
      await running
      chat.cancel({ messageId: 'assistant-1' })

      await vi.waitFor(() => {
        expect(d.finish).toHaveBeenCalledTimes(1)
      })
      expect(d.stream).toHaveBeenCalledTimes(1)
    })
  })
})
