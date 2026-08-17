import { describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from './providers.js'
import { defaultSamplerSettings } from '../shared/types.js'
import { requestBody, streamChat, type ChatRequest } from './chat-api.js'
import type { ToolStep } from '../shared/types.js'
import type { ToolDefinition } from '../shared/tools.js'

const provider: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  api: 'responses',
  organization: '',
  project: '',
}

function request(api: ProviderConfig['api'] = 'responses'): ChatRequest {
  return {
    provider: { ...provider, api },
    model: 'model-1',
    systemPrompt: 'Be useful.',
    history: [
      { id: 'u1', role: 'user', text: 'Hello', status: 'complete', at: 1, attachments: [] },
      {
        id: 'a1',
        role: 'assistant',
        text: 'Hi',
        status: 'complete',
        at: 2,
        attachments: [],
        providerApi: 'responses',
        providerId: 'openai',
        providerItems: [{ type: 'message', role: 'assistant', id: 'msg_1' }],
      },
      { id: 'u2', role: 'user', text: 'Again', status: 'complete', at: 3, attachments: [] },
    ],
    sampling: { ...defaultSamplerSettings },
  }
}

function sse(parts: string[], status = 200): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part))
        controller.close()
      },
    }),
    { status, headers: { 'content-type': 'text/event-stream' } },
  )
}

function attachmentRequest(api: ProviderConfig['api']): ChatRequest {
  return {
    ...request(api),
    history: [
      {
        id: 'u1',
        role: 'user',
        text: '',
        status: 'complete',
        at: 1,
        attachments: [
          {
            id: 'image-1',
            name: 'image.png',
            kind: 'image',
            mediaType: 'image/png',
            size: 2,
            data: Uint8Array.from([1, 2]),
          },
          {
            id: 'pdf-1',
            name: 'document.pdf',
            kind: 'pdf',
            mediaType: 'application/pdf',
            size: 2,
            data: Uint8Array.from([3, 4]),
          },
        ],
      },
    ],
  }
}

describe('requestBody', () => {
  it('builds a Responses request and replays stored output items', () => {
    expect(requestBody(request())).toEqual({
      model: 'model-1',
      instructions: 'Be useful.',
      input: [
        { role: 'user', content: 'Hello' },
        { type: 'message', role: 'assistant', id: 'msg_1' },
        { role: 'user', content: 'Again' },
      ],
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
    })
  })

  it('builds a Chat Completions request from visible roles and text', () => {
    expect(requestBody(request('chat-completions'))).toEqual({
      model: 'model-1',
      messages: [
        { role: 'system', content: 'Be useful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Again' },
      ],
      stream: true,
      store: false,
    })
  })

  it('omits every sampler field while overrides are disabled', () => {
    const body = requestBody(request('chat-completions'))
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('sends portable sampling fields to Responses', () => {
    const configured = request()
    configured.sampling = {
      enabled: true,
      temperature: 0.4,
      topP: 0.8,
      frequencyPenalty: 1,
      presencePenalty: 1,
      seed: 42,
      topK: 20,
      minP: 0.05,
      repeatPenalty: 1.1,
    }

    expect(requestBody(configured)).toMatchObject({ temperature: 0.4, top_p: 0.8 })
    expect(requestBody(configured)).not.toHaveProperty('frequency_penalty')
    expect(requestBody(configured)).not.toHaveProperty('top_k')
  })

  it('sends standard and configured extension fields to Chat Completions', () => {
    const configured = request('chat-completions')
    configured.sampling = {
      enabled: true,
      temperature: 0.6,
      topP: 0.9,
      frequencyPenalty: 0.2,
      presencePenalty: -0.1,
      seed: 7,
      topK: 40,
      minP: 0.05,
      repeatPenalty: 1.1,
    }

    expect(requestBody(configured)).toMatchObject({
      temperature: 0.6,
      top_p: 0.9,
      frequency_penalty: 0.2,
      presence_penalty: -0.1,
      seed: 7,
      top_k: 40,
      min_p: 0.05,
      repeat_penalty: 1.1,
    })
  })

  it('does not send one provider encrypted output from another provider', () => {
    const switched = request()
    switched.provider = { ...switched.provider, id: 'other-provider' }
    expect(requestBody(switched).input).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Again' },
    ])
  })

  it('builds native Responses image and file content for an attachment-only turn', () => {
    expect(requestBody(attachmentRequest('responses')).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: 'data:image/png;base64,AQI=', detail: 'auto' },
          {
            type: 'input_file',
            filename: 'document.pdf',
            file_data: 'data:application/pdf;base64,AwQ=',
            detail: 'auto',
          },
        ],
      },
    ])
  })

  it('builds native Chat Completions image and file content', () => {
    expect(requestBody(attachmentRequest('chat-completions')).messages).toEqual([
      { role: 'system', content: 'Be useful.' },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,AQI=', detail: 'auto' },
          },
          {
            type: 'file',
            file: {
              filename: 'document.pdf',
              file_data: 'data:application/pdf;base64,AwQ=',
            },
          },
        ],
      },
    ])
  })
})

describe('streamChat', () => {
  it('maps optimistic attachment rejections to stable errors', async () => {
    const unsupported = vi.fn(() => Promise.resolve(new Response('', { status: 415 })))
    expect(
      await streamChat(attachmentRequest('responses'), new AbortController().signal, () => undefined, unsupported),
    ).toMatchObject({ ok: false, code: 'chat/attachments-unsupported' })

    const tooLarge = vi.fn(() => Promise.resolve(new Response('', { status: 413 })))
    expect(
      await streamChat(attachmentRequest('responses'), new AbortController().signal, () => undefined, tooLarge),
    ).toMatchObject({ ok: false, code: 'chat/attachments-too-large' })
  })
  it('assembles partial Responses chunks and keeps replay metadata', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        sse([
          'data: {"type":"response.output_text.delta","delta":"Hel',
          'lo"}\n\ndata: {"type":"response.output_text.delta","delta":"!"}\n\n',
          'data: {"type":"response.completed","response":{"output":[{"type":"message","id":"msg_2"}]}}\n\n',
        ]),
      ),
    )
    const deltas: { text: string; reasoning: string }[] = []
    const result = await streamChat(request(), new AbortController().signal, (chunk) => {
      deltas.push(chunk)
    }, fetcher)
    expect(result).toEqual({
      ok: true,
      value: {
        text: 'Hello!',
        reasoning: '',
        providerItems: [{ type: 'message', id: 'msg_2' }],
      },
    })
    expect(deltas).toEqual([
      { text: 'Hello', reasoning: '' },
      { text: 'Hello!', reasoning: '' },
    ])
  })

  it('assembles Chat Completions deltas until DONE', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        sse([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    )
    expect(
      await streamChat(request('chat-completions'), new AbortController().signal, () => undefined, fetcher),
    ).toEqual({ ok: true, value: { text: 'Hi there', reasoning: '' } })
  })

  it('accepts an OpenRouter Responses DONE marker and streams reasoning', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        sse([
          'data: {"type":"response.reasoning.delta","delta":"Checking"}\n\n',
          'data: {"type":"response.output_text.delta","delta":"Answer"}\n\n',
          'data: {"type":"response.completed","response":{"output":[]}}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    )
    const deltas: { text: string; reasoning: string }[] = []
    expect(
      await streamChat(request(), new AbortController().signal, (chunk) => {
        deltas.push(chunk)
      }, fetcher),
    ).toEqual({ ok: true, value: { text: 'Answer', reasoning: 'Checking', providerItems: [] } })
    expect(deltas).toEqual([
      { text: '', reasoning: 'Checking' },
      { text: 'Answer', reasoning: 'Checking' },
    ])
  })

  it('supports OpenAI reasoning summary and reasoning text events', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        sse([
          'data: {"type":"response.reasoning_summary_text.delta","delta":"Summary"}\n\n',
          'data: {"type":"response.reasoning_text.delta","delta":" details"}\n\n',
          'data: {"type":"response.completed","response":{"output":[]}}\n\n',
        ]),
      ),
    )
    expect(
      await streamChat(request(), new AbortController().signal, () => undefined, fetcher),
    ).toEqual({
      ok: true,
      value: { text: '', reasoning: 'Summary details', providerItems: [] },
    })
  })

  it('supports Chat Completions reasoning aliases and completion without DONE', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        sse([
          'data: {"choices":[{"delta":{"reasoning_content":"Think"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Answer"},"finish_reason":"stop"}]}\n\n',
        ]),
      ),
    )
    expect(
      await streamChat(request('chat-completions'), new AbortController().signal, () => undefined, fetcher),
    ).toEqual({ ok: true, value: { text: 'Answer', reasoning: 'Think' } })
  })

  it('extracts plaintext Chat Completions reasoning details', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        sse([
          'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"One"},{"type":"reasoning.encrypted","data":"secret"},{"type":"reasoning.summary","summary":"Two"}]},"finish_reason":"stop"}]}\n\n',
        ]),
      ),
    )
    expect(
      await streamChat(request('chat-completions'), new AbortController().signal, () => undefined, fetcher),
    ).toEqual({ ok: true, value: { text: '', reasoning: 'OneTwo' } })
  })

  it('uses completed Responses output when a server sends no delta events', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        sse([
          'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Whole reply"}]}]}}\n\n',
        ]),
      ),
    )
    const deltas: { text: string; reasoning: string }[] = []
    expect(
      await streamChat(request(), new AbortController().signal, (chunk) => {
        deltas.push(chunk)
      }, fetcher),
    ).toMatchObject({ ok: true, value: { text: 'Whole reply' } })
    expect(deltas).toEqual([{ text: 'Whole reply', reasoning: '' }])
  })

  it('returns a stable error for a provider error mid-stream', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        sse([
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
          'data: {"type":"error","error":{"message":"secret provider detail"}}\n\n',
        ]),
      ),
    )
    expect(await streamChat(request(), new AbortController().signal, () => undefined, fetcher)).toEqual({
      ok: false,
      code: 'chat/provider',
      message: 'provider reported a response error',
    })
  })

  it('maps cancellation without leaking an exception', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn(() =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    )
    expect(await streamChat(request(), controller.signal, () => undefined, fetcher)).toMatchObject({
      ok: false,
      code: 'chat/cancelled',
    })
  })

  it('rejects a stream that ends without its completion marker', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(sse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])),
    )
    expect(
      await streamChat(request('chat-completions'), new AbortController().signal, () => undefined, fetcher),
    ).toMatchObject({ ok: false, code: 'chat/stream-ended' })
  })
})

describe('tool calling', () => {
  const echo: ToolDefinition = {
    name: 'luna_echo',
    description: 'Echoes text.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  }

  const step: ToolStep = {
    callId: 'call_1',
    source: 'builtin',
    name: 'luna_echo',
    arguments: '{"text":"hi"}',
    text: 'hi',
    isError: false,
    truncated: false,
  }

  function bare(api: ProviderConfig['api']): ChatRequest {
    return {
      provider: { ...provider, api },
      model: 'model-1',
      systemPrompt: '',
      history: [],
      sampling: { ...defaultSamplerSettings },
    }
  }

  describe('request body', () => {
    /** With no tools enabled the request must be byte-identical to before. */
    it('adds nothing at all when there are no tools', () => {
      expect(requestBody(request('responses'))).not.toHaveProperty('tools')
      expect(requestBody(request('chat-completions'))).not.toHaveProperty('tools')
      expect(requestBody(request('chat-completions'))).not.toHaveProperty('stream_options')
    })

    it('describes a tool in the Chat Completions shape', () => {
      const body = requestBody({ ...bare('chat-completions'), tools: [echo] })
      expect(body.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'luna_echo',
            description: 'Echoes text.',
            parameters: echo.inputSchema,
          },
        },
      ])
      expect(body.stream_options).toEqual({ include_usage: true })
    })

    it('describes a tool in the Responses shape', () => {
      const body = requestBody({ ...bare('responses'), tools: [echo] })
      expect(body.tools).toEqual([
        {
          type: 'function',
          name: 'luna_echo',
          description: 'Echoes text.',
          parameters: echo.inputSchema,
        },
      ])
    })
  })

  describe('replaying stored rounds', () => {
    const secondStep: ToolStep = {
      ...step,
      callId: 'call_2',
      arguments: '{"text":"again"}',
      text: 'again',
    }

    it('preserves two Chat Completions rounds before the final answer', () => {
      const body = requestBody({
        ...bare('chat-completions'),
        history: [
          {
            id: 'a1',
            role: 'assistant',
            text: 'Both checks passed.',
            status: 'complete',
            at: 1,
            attachments: [],
            toolRounds: [
              { text: 'First check.', steps: [step] },
              { text: 'Second check.', steps: [secondStep] },
            ],
          },
        ],
      })
      expect(body.messages).toEqual([
        {
          role: 'assistant',
          content: 'First check.',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'luna_echo', arguments: '{"text":"hi"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'hi' },
        {
          role: 'assistant',
          content: 'Second check.',
          tool_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: { name: 'luna_echo', arguments: '{"text":"again"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_2', content: 'again' },
        { role: 'assistant', content: 'Both checks passed.' },
      ])
    })

    it('interleaves exact Responses rounds and final provider output', () => {
      const firstItems = [
        { type: 'reasoning', encrypted_content: 'encrypted-first' },
        { type: 'function_call', call_id: 'call_1', name: 'luna_echo' },
      ]
      const secondItems = [
        { type: 'reasoning', encrypted_content: 'encrypted-second' },
        { type: 'function_call', call_id: 'call_2', name: 'luna_echo' },
      ]
      const finalItems = [{ type: 'message', role: 'assistant', content: 'Both checks passed.' }]
      const body = requestBody({
        ...bare('responses'),
        history: [
          {
            id: 'a1',
            role: 'assistant',
            text: 'Both checks passed.',
            status: 'complete',
            at: 1,
            attachments: [],
            providerApi: 'responses',
            providerId: 'openai',
            providerItems: finalItems,
            toolRounds: [
              { text: 'First check.', steps: [step], providerItems: firstItems },
              { text: 'Second check.', steps: [secondStep], providerItems: secondItems },
            ],
          },
        ],
      })
      expect(body.input).toEqual([
        ...firstItems,
        { type: 'function_call_output', call_id: 'call_1', output: 'hi' },
        ...secondItems,
        { type: 'function_call_output', call_id: 'call_2', output: 'again' },
        ...finalItems,
      ])
    })

    it('synthesizes round chronology when the Responses provider changes', () => {
      const body = requestBody({
        ...bare('responses'),
        history: [
          {
            id: 'a1',
            role: 'assistant',
            text: 'Both checks passed.',
            status: 'complete',
            at: 1,
            attachments: [],
            providerApi: 'responses',
            providerId: 'someone-else',
            providerItems: [{ type: 'message', content: 'provider-private' }],
            toolRounds: [
              {
                text: 'First check.',
                steps: [step],
                providerItems: [{ type: 'function_call', call_id: 'call_1' }],
              },
              { text: 'Second check.', steps: [secondStep] },
            ],
          },
        ],
      })
      expect(body.input).toEqual([
        { role: 'assistant', content: 'First check.' },
        { type: 'function_call', call_id: 'call_1', name: 'luna_echo', arguments: '{"text":"hi"}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'hi' },
        { role: 'assistant', content: 'Second check.' },
        {
          type: 'function_call',
          call_id: 'call_2',
          name: 'luna_echo',
          arguments: '{"text":"again"}',
        },
        { type: 'function_call_output', call_id: 'call_2', output: 'again' },
        { role: 'assistant', content: 'Both checks passed.' },
      ])
    })

    it('carries exact mid-turn Responses output into the next request', () => {
      const providerItems = [
        { type: 'reasoning', encrypted_content: 'encrypted-pending' },
        { type: 'function_call', call_id: 'call_1', name: 'luna_echo' },
      ]
      const body = requestBody({
        ...bare('responses'),
        pendingRounds: [{ text: 'Working on it.', steps: [step], providerItems }],
      })
      expect(body.input).toEqual([
        ...providerItems,
        { type: 'function_call_output', call_id: 'call_1', output: 'hi' },
      ])
    })

    it('carries mid-turn Chat Completions rounds not yet in the database', () => {
      const body = requestBody({
        ...bare('chat-completions'),
        pendingRounds: [{ text: 'Working on it.', steps: [step] }],
      })
      expect(body.messages).toEqual([
        {
          role: 'assistant',
          content: 'Working on it.',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'luna_echo', arguments: '{"text":"hi"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'hi' },
      ])
    })
  })
})

describe('tool call accumulation', () => {
  const noop = (): void => undefined

  async function run(api: ProviderConfig['api'], parts: string[]) {
    const fetcher = vi.fn().mockResolvedValue(sse(parts))
    const req: ChatRequest = {
      provider: { ...provider, api },
      model: 'model-1',
      systemPrompt: '',
      history: [],
      sampling: { ...defaultSamplerSettings },
    }
    return await streamChat(req, new AbortController().signal, noop, fetcher)
  }

  describe('Responses', () => {
    it('assembles arguments split mid-token across three chunks', async () => {
      const result = await run('responses', [
        'data: {"type":"response.output_item.added","output_index":0,',
        '"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"luna_echo"}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"te'
        , 'xt\\":\\"hel',
        'lo\\"}"}\n\n',
        'data: {"type":"response.completed","response":{"output":[]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.toolCalls).toEqual([
        { callId: 'call_1', name: 'luna_echo', arguments: '{"text":"hello"}' },
      ])
    })

    /** A delta can beat the item that names it. */
    it('backfills the name when output_item.added arrives after the first delta', async () => {
      const result = await run('responses', [
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{}"}\n\n',
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1",',
        '"type":"function_call","call_id":"call_9","name":"late_name"}}\n\n',
        'data: {"type":"response.completed","response":{"output":[]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.toolCalls).toEqual([
        { callId: 'call_9', name: 'late_name', arguments: '{}' },
      ])
    })

    it('keeps two concurrent calls apart by output index', async () => {
      const result = await run('responses', [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"a","type":"function_call","call_id":"c1","name":"first"}}\n\n',
        'data: {"type":"response.output_item.added","output_index":1,"item":{"id":"b","type":"function_call","call_id":"c2","name":"second"}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"b","delta":"{\\"b\\":2}"}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"a","delta":"{\\"a\\":1}"}\n\n',
        'data: {"type":"response.completed","response":{"output":[]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.toolCalls).toEqual([
        { callId: 'c1', name: 'first', arguments: '{"a":1}' },
        { callId: 'c2', name: 'second', arguments: '{"b":2}' },
      ])
    })

    it('uses the whole-value done form only when nothing accumulated', async () => {
      const result = await run('responses', [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"a","type":"function_call","call_id":"c1","name":"f"}}\n\n',
        'data: {"type":"response.function_call_arguments.done","item_id":"a","arguments":"{\\"whole\\":1}"}\n\n',
        'data: {"type":"response.completed","response":{"output":[]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.toolCalls?.[0]?.arguments).toBe('{"whole":1}')
    })

    it('does not overwrite accumulated arguments with the done form', async () => {
      const result = await run('responses', [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"a","type":"function_call","call_id":"c1","name":"f"}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"a","delta":"{\\"streamed\\":1}"}\n\n',
        'data: {"type":"response.function_call_arguments.done","item_id":"a","arguments":"{\\"whole\\":2}"}\n\n',
        'data: {"type":"response.completed","response":{"output":[]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.toolCalls?.[0]?.arguments).toBe('{"streamed":1}')
    })

    it('recovers a call that only appeared in the final output array', async () => {
      const result = await run('responses', [
        'data: {"type":"response.completed","response":{"output":[',
        '{"id":"fc_9","type":"function_call","call_id":"c9","name":"swept","arguments":"{}"}]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.toolCalls?.[0]?.name).toBe('swept')
    })

    it('keeps two final-only calls to the same function distinct and ordered', async () => {
      const result = await run('responses', [
        'data: {"type":"response.completed","response":{"output":[',
        '{"id":"fc_1","type":"function_call","call_id":"c1","name":"repeat","arguments":"{\\"n\\":1}"},',
        '{"id":"fc_2","type":"function_call","call_id":"c2","name":"repeat","arguments":"{\\"n\\":2}"}]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.toolCalls).toEqual([
        { callId: 'c1', name: 'repeat', arguments: '{"n":1}' },
        { callId: 'c2', name: 'repeat', arguments: '{"n":2}' },
      ])
    })

    it('merges a streamed call by call ID without dropping a same-name final call', async () => {
      const result = await run('responses', [
        'data: {"type":"response.output_item.added","output_index":0,"item":',
        '{"type":"function_call","call_id":"c1","name":"repeat"}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"n\\":1}"}\n\n',
        'data: {"type":"response.completed","response":{"output":[',
        '{"id":"fc_1","type":"function_call","call_id":"c1","name":"repeat","arguments":"{\\"n\\":1}"},',
        '{"id":"fc_2","type":"function_call","call_id":"c2","name":"repeat","arguments":"{\\"n\\":2}"}]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.toolCalls).toEqual([
        { callId: 'c1', name: 'repeat', arguments: '{"n":1}' },
        { callId: 'c2', name: 'repeat', arguments: '{"n":2}' },
      ])
    })

    it('uses output index when the streamed call has no provider identifiers', async () => {
      const result = await run('responses', [
        'data: {"type":"response.output_item.added","output_index":0,"item":',
        '{"type":"function_call","name":"indexed"}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{}"}\n\n',
        'data: {"type":"response.completed","response":{"output":[',
        '{"id":"fc_1","type":"function_call","call_id":"c1","name":"indexed","arguments":"{}"}]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.toolCalls).toEqual([
        { callId: 'c1', name: 'indexed', arguments: '{}' },
      ])
    })

    it('reads token usage from the completed event', async () => {
      const result = await run('responses', [
        'data: {"type":"response.completed","response":{"output":[],"usage":',
        '{"input_tokens":120,"output_tokens":40,"output_tokens_details":{"reasoning_tokens":8},',
        '"input_tokens_details":{"cached_tokens":100}}}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.usage).toEqual({
          inputTokens: 120,
          outputTokens: 40,
          reasoningTokens: 8,
          cachedTokens: 100,
        })
      }
    })
  })

  describe('Chat Completions', () => {
    it('assembles fragments keyed by index with id and name on the first only', async () => {
      const result = await run('chat-completions', [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1",',
        '"function":{"name":"luna_echo","arguments":"{\\"te"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"xt\\":1}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.toolCalls).toEqual([
        { callId: 'call_1', name: 'luna_echo', arguments: '{"text":1}' },
      ])
    })

    /** Regression guard: finish_reason already ended the stream before tools. */
    it('treats tool_calls as a finishing reason', async () => {
      const result = await run('chat-completions', [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"f","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      ])
      expect(result.ok).toBe(true)
    })

    it('reads usage from a final chunk whose choices array is empty', async () => {
      const result = await run('chat-completions', [
        'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.usage).toEqual({ inputTokens: 10, outputTokens: 3 })
    })
  })

  describe('failure during accumulation', () => {
    it('reports a provider error rather than a half-built call', async () => {
      const result = await run('responses', [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"a","type":"function_call","call_id":"c","name":"f"}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"a","delta":"{\\"half"}\n\n',
        'data: {"type":"response.failed"}\n\n',
      ])

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('chat/provider')
    })

    it('cancels mid-accumulation', async () => {
      const controller = new AbortController()
      const fetcher = vi.fn().mockImplementation(() => {
        controller.abort()
        return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
      const result = await streamChat(
        {
          provider: { ...provider, api: 'responses' },
          model: 'model-1',
          systemPrompt: '',
          history: [],
          sampling: { ...defaultSamplerSettings },
        },
        controller.signal,
        noop,
        fetcher,
      )

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('chat/cancelled')
    })

    /**
     * Malformed argument JSON is the model's mistake, not a broken stream. It
     * comes back intact so the dispatcher can turn it into a tool error the
     * model can retry against.
     */
    it('returns malformed argument JSON as-is rather than failing the stream', async () => {
      const result = await run('responses', [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"a","type":"function_call","call_id":"c","name":"f"}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"a","delta":"{not json"}\n\n',
        'data: {"type":"response.completed","response":{"output":[]}}\n\n',
      ])

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.toolCalls?.[0]?.arguments).toBe('{not json')
    })
  })
})
