import { err, ok, type Result } from '../shared/result.js'
import { providerHeaders } from './openai.js'
import type { ProviderConfig } from './providers.js'
import type { StoredMessage, StoredToolRound } from './chats.js'
import type { SamplerSettings, TokenUsage, ToolRound, ToolStep } from '../shared/types.js'
import type { ToolDefinition } from '../shared/tools.js'
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
  /** Tools the model may call this turn. Names must already be unique. */
  tools?: readonly ToolDefinition[]
  /**
   * Calls and results from earlier iterations of this same turn.
   *
   * They are not in `history` because nothing mid-turn is written to the
   * database — the assistant row stays `streaming` until the loop ends, and
   * requestBody skips rows that are not complete.
   */
  pendingRounds?: readonly StoredToolRound[]
}

/** One tool call the model asked for, reassembled from stream fragments. */
export type StreamToolCall = {
  callId: string
  name: string
  /** Accumulated JSON text. Deliberately not parsed here — see chatEvent. */
  arguments: string
}

export type ChatCompletion = {
  text: string
  reasoning: string
  providerItems?: unknown[]
  toolCalls?: StreamToolCall[]
  usage?: TokenUsage
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

/** The two shapes the same tool list takes on the two request surfaces. */
function toolsBody(
  tools: readonly ToolDefinition[],
  api: ProviderConfig['api'],
): Record<string, unknown> {
  if (tools.length === 0) return {}
  if (api === 'chat-completions') {
    return {
      tools: tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
    }
  }
  return {
    tools: tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
  }
}

/**
 * Replays tool steps as a Chat Completions assistant turn plus its results.
 *
 * The call and its result are always emitted together. One without the other is
 * a hard 400 from the provider, so there is no branch here that can produce a
 * half pair.
 */
function chatRound(round: ToolRound, messages: Record<string, unknown>[]): void {
  messages.push({
    role: 'assistant',
    content: round.text,
    tool_calls: round.steps.map((step) => ({
      id: step.callId,
      type: 'function',
      function: { name: step.name, arguments: step.arguments },
    })),
  })
  for (const step of round.steps) {
    messages.push({ role: 'tool', tool_call_id: step.callId, content: step.text })
  }
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

/** The same pair, as Responses input items. */
function responseSteps(steps: readonly ToolStep[], input: unknown[], withCalls: boolean): void {
  for (const step of steps) {
    // When provider items were replayed verbatim the function_call is already
    // in the input, so emitting it again would duplicate the call.
    if (withCalls) {
      input.push({
        type: 'function_call',
        call_id: step.callId,
        name: step.name,
        arguments: step.arguments,
      })
    }
    input.push({ type: 'function_call_output', call_id: step.callId, output: step.text })
  }
}

/** Replays one Responses round exactly when its provider output is available. */
function responseRound(round: StoredToolRound, input: unknown[], exact: boolean): void {
  if (exact && round.providerItems !== undefined) {
    input.push(...replayItems(round.providerItems))
    responseSteps(round.steps, input, false)
    return
  }
  if (round.text !== '') input.push({ role: 'assistant', content: round.text })
  responseSteps(round.steps, input, true)
}

export function requestBody(request: ChatRequest): Record<string, unknown> {
  const sampling = samplingBody(request.sampling, request.provider.api)
  const tools = toolsBody(request.tools ?? [], request.provider.api)
  const pending = request.pendingRounds ?? []

  if (request.provider.api === 'chat-completions') {
    const messages: Record<string, unknown>[] = []
    if (request.systemPrompt !== '') {
      messages.push({ role: 'system', content: request.systemPrompt })
    }
    for (const message of request.history) {
      if (message.status !== 'complete') continue
      if (message.role === 'assistant' && message.toolRounds !== undefined) {
        for (const round of message.toolRounds) chatRound(round, messages)
        messages.push({ role: 'assistant', content: message.text })
        continue
      }
      messages.push({
        role: message.role,
        content: message.role === 'user' ? chatContent(message) : message.text,
      })
    }
    for (const round of pending) chatRound(round, messages)
    return {
      model: request.model,
      messages,
      stream: true,
      store: false,
      // Usage arrives on a final chunk only when this is asked for.
      ...(tools.tools === undefined ? {} : { stream_options: { include_usage: true } }),
      ...tools,
      ...sampling,
    }
  }

  const input: unknown[] = []
  for (const message of request.history) {
    if (message.status !== 'complete') continue
    if (message.role === 'assistant' && message.toolRounds !== undefined) {
      const exact =
        message.providerId === request.provider.id && message.providerApi === 'responses'
      for (const round of message.toolRounds) responseRound(round, input, exact)
      if (exact && message.providerItems !== undefined) {
        input.push(...replayItems(message.providerItems))
      } else {
        input.push({ role: 'assistant', content: message.text })
      }
      continue
    }
    if (
      message.role === 'assistant' &&
      message.providerId === request.provider.id &&
      message.providerApi === 'responses' &&
      message.providerItems !== undefined
    ) {
      input.push(...replayItems(message.providerItems))
      continue
    }
    input.push({
      role: message.role,
      content: message.role === 'user' ? responseContent(message) : message.text,
    })
  }
  for (const round of pending) responseRound(round, input, true)

  return {
    model: request.model,
    ...(request.systemPrompt === '' ? {} : { instructions: request.systemPrompt }),
    input,
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    ...tools,
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
  /**
   * Tool calls under construction, keyed by whatever the API uses to correlate
   * fragments. `order` preserves arrival order, because a Map keyed by item id
   * does not tell you which call the model asked for first.
   */
  toolCalls: Map<string, { order: number; call: StreamToolCall }>
  usage?: TokenUsage
}

/** Finds or starts the entry a fragment belongs to. */
function callSlot(state: StreamState, key: string): StreamToolCall {
  const existing = state.toolCalls.get(key)
  if (existing !== undefined) return existing.call
  // A fragment can arrive before the item that names it, so start empty and let
  // the naming event fill it in later.
  const call: StreamToolCall = { callId: '', name: '', arguments: '' }
  state.toolCalls.set(key, { order: state.toolCalls.size, call })
  return call
}

function orderedCalls(state: StreamState): StreamToolCall[] {
  const used = new Set<string>()
  const calls: StreamToolCall[] = []
  for (const entry of [...state.toolCalls.values()].sort((a, b) => a.order - b.order)) {
    const call = entry.call
    // A call with no name was never completed and cannot be dispatched.
    if (call.name === '') continue
    let callId = call.callId
    if (callId === '' || used.has(callId)) {
      let suffix = entry.order
      do {
        callId = `luna_call_${String(suffix)}`
        suffix += 1
      } while (used.has(callId))
    }
    used.add(callId)
    calls.push({ ...call, callId })
  }
  return calls
}

/** First report wins; a later chunk repeating it must not overwrite it. */
function recordUsage(state: StreamState, parsed: TokenUsage | undefined): void {
  if (parsed !== undefined && state.usage === undefined) state.usage = parsed
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

/** Responses reports totals under its own names, with details one level down. */
function responseUsage(value: unknown): TokenUsage | undefined {
  const cell = object(value)
  if (cell === undefined) return undefined
  const input = positive(cell.input_tokens)
  const output = positive(cell.output_tokens)
  const reasoning = positive(object(cell.output_tokens_details)?.reasoning_tokens)
  const cached = positive(object(cell.input_tokens_details)?.cached_tokens)
  if ([input, output, reasoning, cached].every((entry) => entry === undefined)) return undefined
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
    ...(cached === undefined ? {} : { cachedTokens: cached }),
  }
}

/** Chat Completions uses prompt/completion for the same two numbers. */
function chatUsage(value: unknown): TokenUsage | undefined {
  const cell = object(value)
  if (cell === undefined) return undefined
  const input = positive(cell.prompt_tokens)
  const output = positive(cell.completion_tokens)
  const reasoning = positive(object(cell.completion_tokens_details)?.reasoning_tokens)
  const cached = positive(object(cell.prompt_tokens_details)?.cached_tokens)
  if ([input, output, reasoning, cached].every((entry) => entry === undefined)) return undefined
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
    ...(cached === undefined ? {} : { cachedTokens: cached }),
  }
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

/**
 * Correlates a fragment to its call.
 *
 * `item_id` is the reliable key; `output_index` is the fallback for servers
 * that omit it. Both are used consistently so a delta arriving before its
 * `output_item.added` still lands in the same slot.
 */
function itemKey(body: Record<string, unknown>, item: Record<string, unknown> | undefined): string {
  const id = item?.id ?? body.item_id
  if (typeof id === 'string' && id !== '') return id
  return indexKey(body.output_index)
}

/** A positional fallback key. Anything that is not a number collapses to zero. */
function indexKey(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `index:${String(value)}` : 'index:0'
}

/** Finds the streamed slot represented by one final Responses item. */
function finalCallSlot(
  state: StreamState,
  item: Record<string, unknown>,
  outputIndex: number,
): StreamToolCall {
  const itemId = typeof item.id === 'string' && item.id !== '' ? item.id : undefined
  const callId =
    typeof item.call_id === 'string' && item.call_id !== '' ? item.call_id : undefined
  let slot = itemId === undefined ? undefined : state.toolCalls.get(itemId)
  if (slot === undefined && callId !== undefined) {
    slot = [...state.toolCalls.values()].find((entry) => entry.call.callId === callId)
  }
  slot ??= state.toolCalls.get(indexKey(outputIndex))
  if (slot === undefined) {
    const key = itemId ?? (callId === undefined ? indexKey(outputIndex) : `call-id:${callId}`)
    const call = callSlot(state, key)
    const created = state.toolCalls.get(key)
    if (created !== undefined) created.order = outputIndex
    return call
  }
  // The completed output is authoritative for call order, including when an
  // earlier call had no streamed fragments but a later one did.
  slot.order = outputIndex
  return slot.call
}

/** Picks up any call the deltas missed, from the final output array. */
function sweepCalls(state: StreamState, output: unknown[]): void {
  for (const [outputIndex, entry] of output.entries()) {
    const item = object(entry)
    if (item?.type !== 'function_call' || typeof item.name !== 'string') continue
    const call = finalCallSlot(state, item, outputIndex)
    if (call.name === '') call.name = item.name
    if (call.callId === '' && typeof item.call_id === 'string') call.callId = item.call_id
    if (call.arguments === '' && typeof item.arguments === 'string') {
      call.arguments = item.arguments
    }
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
  if (type === 'response.output_item.added') {
    const item = object(body.item)
    if (item?.type === 'function_call') {
      const call = callSlot(state, itemKey(body, item))
      if (typeof item.call_id === 'string') call.callId = item.call_id
      if (typeof item.name === 'string') call.name = item.name
      if (typeof item.arguments === 'string') call.arguments += item.arguments
    }
    return ok(undefined)
  }
  if (type === 'response.function_call_arguments.delta') {
    if (typeof body.delta !== 'string') {
      return err('chat/bad-stream', 'function call arguments delta was not text')
    }
    callSlot(state, itemKey(body, undefined)).arguments += body.delta
    return ok(undefined)
  }
  if (type === 'response.function_call_arguments.done') {
    // Only trust the whole-value form when nothing was accumulated, the same
    // way reasoning_text.done is treated above.
    const call = callSlot(state, itemKey(body, undefined))
    if (call.arguments === '' && typeof body.arguments === 'string') {
      call.arguments = body.arguments
    }
    return ok(undefined)
  }
  if (type === 'response.failed' || type === 'error') {
    return err('chat/provider', 'provider reported a response error')
  }
  if (type === 'response.completed' || type === 'response.incomplete') {
    const response = object(body.response)
    recordUsage(state, responseUsage(response?.usage))
    if (Array.isArray(response?.output)) {
      state.providerItems = response.output
      sweepCalls(state, response.output)
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

/**
 * Accumulates Chat Completions tool-call fragments.
 *
 * Fragments correlate by `index`, and `id` and `function.name` appear on the
 * first fragment only — later ones carry nothing but more argument text. So
 * each field is assigned only while it is still empty.
 */
function collectChatCalls(state: StreamState, fragments: unknown[]): void {
  for (const entry of fragments) {
    const fragment = object(entry)
    if (fragment === undefined) continue
    const call = callSlot(state, indexKey(fragment.index))
    if (call.callId === '' && typeof fragment.id === 'string') call.callId = fragment.id
    const fn = object(fragment.function)
    if (fn === undefined) continue
    if (call.name === '' && typeof fn.name === 'string') call.name = fn.name
    if (typeof fn.arguments === 'string') call.arguments += fn.arguments
  }
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
  // Usage arrives on a final chunk whose choices array is empty, so it has to
  // be read before the early return below.
  recordUsage(state, chatUsage(body.usage))
  if (!Array.isArray(body.choices)) return ok(undefined)
  let text = ''
  let reasoning = ''
  for (const choice of body.choices) {
    const parsedChoice = object(choice)
    const finishReason = parsedChoice?.finish_reason
    if (finishReason === 'error') {
      return err('chat/provider', 'provider reported a completion error')
    }
    // 'tool_calls' is a finish reason like any other, so this already ends the
    // stream when the model asked for tools rather than answering.
    if (typeof finishReason === 'string' && finishReason !== '') state.done = true
    const item = object(parsedChoice?.delta)
    if (item === undefined) continue
    text += textParts(item.content)
    if (typeof item.refusal === 'string') text += item.refusal
    reasoning += chatReasoning(item)
    if (Array.isArray(item.tool_calls)) collectChatCalls(state, item.tool_calls)
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
  const state: StreamState = {
    text: '',
    reasoning: '',
    done: false,
    toolCalls: new Map(),
  }
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
  const toolCalls = orderedCalls(state)
  return ok({
    text: state.text,
    reasoning: state.reasoning,
    ...(state.providerItems === undefined ? {} : { providerItems: state.providerItems }),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    ...(state.usage === undefined ? {} : { usage: state.usage }),
  })
}
