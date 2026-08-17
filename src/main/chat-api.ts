import { err, ok, type Result } from '../shared/result.js'
import { providerHeaders } from './openai.js'
import type { ProviderConfig } from './providers.js'
import type { StoredMessage } from './chats.js'
import type { SamplerSettings } from '../shared/types.js'
import { object } from './parse.js'
import { SseParser, type SseEvent } from './sse.js'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export type ChatRequest = {
  provider: ProviderConfig
  apiKey?: string
  model: string
  systemPrompt: string
  history: StoredMessage[]
  sampling: SamplerSettings
}

export type ChatCompletion = {
  text: string
  reasoning: string
  providerItems?: unknown[]
}

export type ChatChunk = {
  text: string
  reasoning: string
}

function dataUrl(mediaType: string, data: Uint8Array): string {
  return `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`
}

function chatContent(message: StoredMessage): string | Record<string, unknown>[] {
  if (message.attachments.length === 0) return message.text
  const content: Record<string, unknown>[] = []
  if (message.text !== '') content.push({ type: 'text', text: message.text })
  for (const attachment of message.attachments) {
    const url = dataUrl(attachment.mediaType, attachment.data)
    if (attachment.kind === 'image') {
      content.push({ type: 'image_url', image_url: { url, detail: 'auto' } })
    } else {
      content.push({
        type: 'file',
        file: { filename: attachment.name, file_data: url },
      })
    }
  }
  return content
}

function responseContent(message: StoredMessage): string | Record<string, unknown>[] {
  if (message.attachments.length === 0) return message.text
  const content: Record<string, unknown>[] = []
  if (message.text !== '') content.push({ type: 'input_text', text: message.text })
  for (const attachment of message.attachments) {
    const url = dataUrl(attachment.mediaType, attachment.data)
    if (attachment.kind === 'image') {
      content.push({ type: 'input_image', image_url: url, detail: 'auto' })
    } else {
      content.push({
        type: 'input_file',
        filename: attachment.name,
        file_data: url,
        ...(attachment.kind === 'pdf' ? { detail: 'auto' } : {}),
      })
    }
  }
  return content
}

/** Compatible servers may expose plaintext reasoning that must not be replayed as input. */
function replayItems(items: unknown[]): unknown[] {
  return items.filter((item) => {
    const value = object(item)
    return (
      value?.type !== 'reasoning' ||
      (typeof value.encrypted_content === 'string' && value.encrypted_content !== '')
    )
  })
}

export function requestBody(request: ChatRequest): Record<string, unknown> {
  const sampling = samplingBody(request.sampling, request.provider.api)
  if (request.provider.api === 'chat-completions') {
    const messages: Record<string, unknown>[] = []
    if (request.systemPrompt !== '') {
      messages.push({ role: 'system', content: request.systemPrompt })
    }
    for (const message of request.history) {
      if (message.status !== 'complete') continue
      messages.push({
        role: message.role,
        content: message.role === 'user' ? chatContent(message) : message.text,
      })
    }
    return { model: request.model, messages, stream: true, store: false, ...sampling }
  }

  const input: unknown[] = []
  for (const message of request.history) {
    if (message.status !== 'complete') continue
    if (
      message.role === 'assistant' &&
      message.providerId === request.provider.id &&
      message.providerApi === 'responses' &&
      message.providerItems !== undefined
    ) {
      input.push(...replayItems(message.providerItems))
    } else {
      input.push({
        role: message.role,
        content: message.role === 'user' ? responseContent(message) : message.text,
      })
    }
  }
  return {
    model: request.model,
    ...(request.systemPrompt === '' ? {} : { instructions: request.systemPrompt }),
    input,
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    ...sampling,
  }
}

export function samplingBody(
  sampling: SamplerSettings,
  api: ProviderConfig['api'],
): Record<string, unknown> {
  if (!sampling.enabled) return {}
  const common: Record<string, unknown> = {
    temperature: sampling.temperature,
    top_p: sampling.topP,
  }
  if (api === 'responses') return common
  return {
    ...common,
    frequency_penalty: sampling.frequencyPenalty,
    presence_penalty: sampling.presencePenalty,
    ...(sampling.seed === null ? {} : { seed: sampling.seed }),
    ...(sampling.topK === null ? {} : { top_k: sampling.topK }),
    ...(sampling.minP === null ? {} : { min_p: sampling.minP }),
    ...(sampling.repeatPenalty === null ? {} : { repeat_penalty: sampling.repeatPenalty }),
  }
}

function outputText(items: unknown[]): string {
  let text = ''
  for (const item of items) {
    const content = object(item)?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const value = object(part)
      if (typeof value?.text === 'string') text += value.text
      else if (typeof value?.refusal === 'string') text += value.refusal
    }
  }
  return text
}

function textParts(input: unknown): string {
  if (typeof input === 'string') return input
  if (!Array.isArray(input)) return ''
  let text = ''
  for (const part of input) {
    const value = object(part)
    if (typeof value?.text === 'string') text += value.text
    else if (typeof value?.content === 'string') text += value.content
  }
  return text
}

function reasoningDetails(input: unknown): string {
  if (!Array.isArray(input)) return ''
  let reasoning = ''
  for (const detail of input) {
    const value = object(detail)
    if (typeof value?.text === 'string') reasoning += value.text
    else if (typeof value?.summary === 'string') reasoning += value.summary
  }
  return reasoning
}

function outputReasoning(items: unknown[]): string {
  let reasoning = ''
  for (const item of items) {
    const value = object(item)
    if (typeof value?.reasoning === 'string') reasoning += value.reasoning
    reasoning += reasoningDetails(value?.summary)
    if (!Array.isArray(value?.content)) continue
    for (const part of value.content) {
      const content = object(part)
      if (content?.type === 'reasoning_text' && typeof content.text === 'string') {
        reasoning += content.text
      }
    }
  }
  return reasoning
}

function statusError(status: number, hasAttachments: boolean): Result<never> {
  if (status === 401 || status === 403) {
    return err('chat/auth', 'provider rejected the credential')
  }
  if (status === 404) return err('chat/endpoint', 'provider endpoint was not found')
  if (status === 429) return err('chat/rate-limit', 'provider rate limit reached')
  if (hasAttachments && status === 413) {
    return err('chat/attachments-too-large', 'provider rejected the attachment payload size')
  }
  if (hasAttachments && (status === 400 || status === 415 || status === 422)) {
    return err('chat/attachments-unsupported', 'provider rejected attachment input')
  }
  return err('chat/http', `provider returned HTTP ${String(status)}`)
}

type StreamState = {
  text: string
  reasoning: string
  done: boolean
  providerItems?: unknown[]
}

type EventDelta = {
  text?: string
  reasoning?: string
}

function parseJson(data: string): Record<string, unknown> | undefined {
  try {
    return object(JSON.parse(data))
  } catch {
    return undefined
  }
}

function responseEvent(event: SseEvent, state: StreamState): Result<EventDelta | undefined> {
  if (event.data === '[DONE]') {
    state.done = true
    return ok(undefined)
  }
  const body = parseJson(event.data)
  if (body === undefined) return err('chat/bad-stream', 'provider sent invalid stream JSON')
  const type = typeof body.type === 'string' ? body.type : event.event
  if (type === 'response.output_text.delta') {
    if (typeof body.delta !== 'string') {
      return err('chat/bad-stream', 'response delta was not text')
    }
    return ok({ text: body.delta })
  }
  if (type === 'response.refusal.delta') {
    if (typeof body.delta !== 'string') {
      return err('chat/bad-stream', 'response refusal delta was not text')
    }
    return ok({ text: body.delta })
  }
  if (
    type === 'response.reasoning.delta' ||
    type === 'response.reasoning_text.delta' ||
    type === 'response.reasoning_summary_text.delta'
  ) {
    if (typeof body.delta !== 'string') {
      return err('chat/bad-stream', 'response reasoning delta was not text')
    }
    return ok({ reasoning: body.delta })
  }
  if (type === 'response.reasoning_text.done' || type === 'response.reasoning_summary_text.done') {
    return state.reasoning === '' && typeof body.text === 'string'
      ? ok({ reasoning: body.text })
      : ok(undefined)
  }
  if (type === 'response.failed' || type === 'error') {
    return err('chat/provider', 'provider reported a response error')
  }
  if (type === 'response.completed' || type === 'response.incomplete') {
    const response = object(body.response)
    if (Array.isArray(response?.output)) {
      state.providerItems = response.output
      const text = state.text === '' ? outputText(response.output) : ''
      const reasoning = state.reasoning === '' ? outputReasoning(response.output) : ''
      state.done = true
      return ok({
        ...(text === '' ? {} : { text }),
        ...(reasoning === '' ? {} : { reasoning }),
      })
    }
    state.done = true
  }
  return ok(undefined)
}

function chatReasoning(delta: Record<string, unknown>): string {
  const direct = [delta.reasoning, delta.reasoning_content, delta.thinking].find(
    (value) => typeof value === 'string' && value !== '',
  )
  return typeof direct === 'string' ? direct : reasoningDetails(delta.reasoning_details)
}

function chatEvent(event: SseEvent, state: StreamState): Result<EventDelta | undefined> {
  if (event.data === '[DONE]') {
    state.done = true
    return ok(undefined)
  }
  const body = parseJson(event.data)
  if (body === undefined) return err('chat/bad-stream', 'provider sent invalid stream JSON')
  if (object(body.error) !== undefined) {
    return err('chat/provider', 'provider reported a completion error')
  }
  if (!Array.isArray(body.choices)) return ok(undefined)
  let text = ''
  let reasoning = ''
  for (const choice of body.choices) {
    const parsedChoice = object(choice)
    const finishReason = parsedChoice?.finish_reason
    if (finishReason === 'error') {
      return err('chat/provider', 'provider reported a completion error')
    }
    if (typeof finishReason === 'string' && finishReason !== '') state.done = true
    const item = object(parsedChoice?.delta)
    if (item === undefined) continue
    text += textParts(item.content)
    if (typeof item.refusal === 'string') text += item.refusal
    reasoning += chatReasoning(item)
  }
  return ok({
    ...(text === '' ? {} : { text }),
    ...(reasoning === '' ? {} : { reasoning }),
  })
}

function isAbort(error: unknown): boolean {
  return object(error)?.name === 'AbortError'
}

export async function streamChat(
  request: ChatRequest,
  signal: AbortSignal,
  onDelta: (chunk: ChatChunk) => void,
  fetcher: Fetch,
): Promise<Result<ChatCompletion>> {
  let response: Response
  const endpoint = request.provider.api === 'responses' ? 'responses' : 'chat/completions'
  try {
    response = await fetcher(`${request.provider.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...providerHeaders(request.provider, request.apiKey, 'text/event-stream'),
      },
      body: JSON.stringify(requestBody(request)),
      signal,
    })
  } catch (error) {
    return isAbort(error)
      ? err('chat/cancelled', 'chat request was cancelled')
      : err('chat/network', 'provider request failed')
  }

  const hasAttachments = request.history.some((message) => message.attachments.length > 0)
  if (!response.ok) return statusError(response.status, hasAttachments)
  if (response.body === null) return err('chat/bad-stream', 'provider returned no stream')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseParser()
  const state: StreamState = { text: '', reasoning: '', done: false }
  const consume = (events: SseEvent[]): Result<undefined> => {
    for (const event of events) {
      const parsed =
        request.provider.api === 'responses'
          ? responseEvent(event, state)
          : chatEvent(event, state)
      if (!parsed.ok) return parsed
      if (parsed.value !== undefined) {
        state.text += parsed.value.text ?? ''
        state.reasoning += parsed.value.reasoning ?? ''
        if (parsed.value.text !== undefined || parsed.value.reasoning !== undefined) {
          onDelta({ text: state.text, reasoning: state.reasoning })
        }
      }
    }
    return ok(undefined)
  }

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (!(chunk.value instanceof Uint8Array)) {
        return err('chat/bad-stream', 'provider stream chunk was not bytes')
      }
      const consumed = consume(parser.push(decoder.decode(chunk.value, { stream: true })))
      if (!consumed.ok) return consumed
    }
    const trailing = consume(parser.push(decoder.decode()))
    if (!trailing.ok) return trailing
    const finished = consume(parser.finish())
    if (!finished.ok) return finished
  } catch (error) {
    return isAbort(error) || signal.aborted
      ? err('chat/cancelled', 'chat request was cancelled')
      : err('chat/network', 'provider stream failed')
  } finally {
    reader.releaseLock()
  }

  if (!state.done) return err('chat/stream-ended', 'provider stream ended before completion')
  return ok({
    text: state.text,
    reasoning: state.reasoning,
    ...(state.providerItems === undefined ? {} : { providerItems: state.providerItems }),
  })
}
