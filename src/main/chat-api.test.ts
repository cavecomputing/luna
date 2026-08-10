import { describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from './providers.js'
import { requestBody, streamChat, type ChatRequest } from './chat-api.js'

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
      { id: 'u1', role: 'user', text: 'Hello', status: 'complete', at: 1 },
      {
        id: 'a1',
        role: 'assistant',
        text: 'Hi',
        status: 'complete',
        at: 2,
        providerApi: 'responses',
        providerId: 'openai',
        providerItems: [{ type: 'message', role: 'assistant', id: 'msg_1' }],
      },
      { id: 'u2', role: 'user', text: 'Again', status: 'complete', at: 3 },
    ],
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

  it('does not send one provider encrypted output from another provider', () => {
    const switched = request()
    switched.provider = { ...switched.provider, id: 'other-provider' }
    expect(requestBody(switched).input).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Again' },
    ])
  })
})

describe('streamChat', () => {
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
    const deltas: string[] = []
    const result = await streamChat(request(), new AbortController().signal, (text) => {
      deltas.push(text)
    }, fetcher)
    expect(deltas).toEqual(['Hello', 'Hello!'])
    expect(result).toEqual({
      ok: true,
      value: {
        text: 'Hello!',
        providerItems: [{ type: 'message', id: 'msg_2' }],
      },
    })
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
    ).toEqual({ ok: true, value: { text: 'Hi there' } })
  })

  it('uses completed Responses output when a server sends no delta events', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        sse([
          'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Whole reply"}]}]}}\n\n',
        ]),
      ),
    )
    const deltas: string[] = []
    expect(
      await streamChat(request(), new AbortController().signal, (text) => {
        deltas.push(text)
      }, fetcher),
    ).toMatchObject({ ok: true, value: { text: 'Whole reply' } })
    expect(deltas).toEqual(['Whole reply'])
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
