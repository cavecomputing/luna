import { net } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Prefs } from '../../shared/prefs.js'
import { err, ok, type Result } from '../../shared/result.js'
import type { ChatStart } from '../../shared/ipc.js'
import type {
  Conversation,
  ConversationSummary,
  Message,
  ModelSlots,
  Mode,
} from '../../shared/types.js'
import { parseThinkingTags } from '../../shared/thinking.js'
import {
  streamChat,
  type ChatChunk,
  type ChatCompletion,
  type ChatRequest,
  type StreamToolCall,
} from '../chat-api.js'
import * as chats from '../chats.js'
import * as attachmentJobs from '../attachment-jobs.js'
import type { StoredAttachment } from '../attachments.js'
import type { StoredMessage, Turn, TurnOutcome } from '../chats.js'
import * as db from '../db.js'
import { id, object, text } from '../parse.js'
import * as prefs from '../prefs.js'
import * as providers from '../providers.js'
import type { ProviderConfig } from '../providers.js'
import * as secrets from '../secrets.js'
import { LUNA_SYSTEM_PROMPT } from '../system-prompt.js'
import * as grants from '../tool-grants.js'
import { requestApproval, type Approval, type ApprovalRequest } from '../tool-consent.js'
import { type ToolCall } from '../tools/registry.js'
import { registry as toolRegistry } from './tools.js'
import type { ToolOutcome } from '../tools/result.js'
import {
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TOOL_ITERATIONS,
  type ToolInfo,
} from '../../shared/tools.js'
import type { StoredToolRound } from '../chats.js'
import type { TokenUsage, ToolStep } from '../../shared/types.js'
import {
  DEFAULT_CONTEXT_TOKENS,
  estimateTokens,
  historyBudget,
  planHistory,
  type Sized,
} from '../../shared/tokens.js'
import { broadcast, handle } from './bus.js'
import { listTools } from './tools.js'

type Deps = {
  getChat: (id: string) => Conversation | undefined
  slots: () => ModelSlots
  getProvider: (id: string) => ProviderConfig | undefined
  readKey: (id: string) => Promise<string | undefined>
  prefs: () => Prefs
  begin: (
    conversationId: string,
    text: string,
    userMessageId: string,
    assistantMessageId: string,
    now: number,
    attachmentIds: string[],
  ) => Turn | undefined
  retryTarget: (messageId: string) => string | undefined
  restart: (messageId: string, now: number) => Conversation | undefined
  history: (conversationId: string) => Promise<StoredMessage[]>
  finish: (
    id: string,
    text: string,
    reasoning: string,
    status: 'complete' | 'error' | 'cancelled',
    now: number,
    outcome?: TurnOutcome,
  ) => Message | undefined
  setTitle: (id: string, title: string) => Conversation | undefined
  list: () => ConversationSummary[]
  stream: (
    request: ChatRequest,
    signal: AbortSignal,
    onDelta: (chunk: ChatChunk) => void,
  ) => Promise<Result<ChatCompletion>>
  /** Tools the user has enabled, snapshotted once per turn. */
  toolCatalog: (signal: AbortSignal) => Promise<ToolInfo[]>
  callTool: (source: string, call: ToolCall, signal: AbortSignal) => Promise<ToolOutcome>
  approve: (request: ApprovalRequest, signal: AbortSignal) => Promise<Approval>
  /** Persists "always allow". Only ever reached from the native prompt. */
  allowAlways: (source: string, name: string, now: number) => void
  newId: () => string
  now: () => number
  notifyChats: (chats: ConversationSummary[]) => void
  notifyDelta: (data: {
    conversationId: string
    messageId: string
    text: string
    reasoning: string
    seq: number
  }) => void
  notifyDone: (conversationId: string, message: Message) => void
  notifyError: (conversationId: string, message: Message, code: string) => void
}

const deps: Deps = {
  getChat: chats.get,
  slots: providers.slots,
  getProvider: providers.get,
  readKey: secrets.read,
  prefs: prefs.load,
  begin: (conversationId, text, userId, assistantId, now, attachmentIds) =>
    chats.beginTurn(db.handle(), conversationId, text, userId, assistantId, now, attachmentIds),
  retryTarget: chats.retry,
  restart: (messageId, now) => chats.restartMessage(db.handle(), messageId, now),
  history: async (conversationId) => {
    const loaded = await attachmentJobs.readHistory(db.filePath(), conversationId)
    if (loaded === undefined) throw new Error('attachment history read failed')
    const grouped = new Map<string, StoredAttachment[]>()
    for (const item of loaded) {
      const { messageId, ...stored } = item
      const existing = grouped.get(messageId) ?? []
      existing.push(stored)
      grouped.set(messageId, existing)
    }
    return chats.transcriptWith(conversationId, grouped)
  },
  finish: (id, text, reasoning, status, now, outcome) =>
    chats.finishMessage(db.handle(), id, text, reasoning, status, now, outcome),
  setTitle: (id, title) => chats.setTitle(db.handle(), id, title),
  list: chats.load,
  stream: (request, signal, onDelta) =>
    streamChat(request, signal, onDelta, (input, init) => net.fetch(input, init)),
  toolCatalog: async (signal) => {
    const listed = await listTools()
    if (!listed.ok) return []
    // Snapshotting only enabled tools means a tool switched on mid-turn cannot
    // affect the turn already in flight.
    return listed.value.filter((tool) => tool.enabled && !signal.aborted)
  },
  callTool: (source, call, signal) => toolRegistry.call(source, call, signal),
  approve: (request, signal) => requestApproval(request, signal),
  allowAlways: (source, name, now) => {
    grants.setPolicy(db.handle(), source, name, 'allow', now)
  },
  newId: randomUUID,
  now: Date.now,
  notifyChats: (value) => {
    broadcast('chats:changed', value)
  },
  notifyDelta: (data) => {
    broadcast('chat:delta', data)
  },
  notifyDone: (conversationId, message) => {
    broadcast('chat:done', { conversationId, message })
  },
  notifyError: (conversationId, message, code) => {
    broadcast('chat:error', { conversationId, message, code })
  },
}

function attachmentIds(input: unknown): string[] | undefined {
  if (!Array.isArray(input) || input.length > 5) return undefined
  const parsed = input.flatMap((value) => {
    const parsedId = id(value)
    return parsedId === undefined ? [] : [parsedId]
  })
  return parsed.length === input.length && new Set(parsed).size === parsed.length
    ? parsed
    : undefined
}

function combineReasoning(structured: string, tagged: string): string {
  if (structured === '') return tagged
  if (tagged === '' || structured === tagged) return structured
  return `${structured}\n\n${tagged}`
}

/**
 * What one stored message costs, for history planning.
 *
 * Attachment bytes are counted from their declared size rather than encoded,
 * since base64-ing every attachment just to measure it would cost more than the
 * estimate is worth. Tool rounds count too — a turn that ran tools is often the
 * largest thing in a transcript.
 */
function sizeOf(message: StoredMessage): Sized {
  let tokens = estimateTokens(message.text) + estimateTokens(message.reasoning ?? '')
  for (const attachment of message.attachments) tokens += Math.ceil(attachment.size / 3)
  for (const round of message.toolRounds ?? []) {
    tokens += estimateTokens(round.text)
    for (const step of round.steps) {
      tokens += estimateTokens(step.arguments) + estimateTokens(step.text)
    }
  }
  return { role: message.role, tokens }
}

/** Joins one round's text onto the rounds before it. */
function joinText(before: string, next: string): string {
  if (before === '') return next
  if (next === '') return before
  return `${before}\n\n${next}`
}

/** Sums a round's usage into the turn total, in place. */
function addUsage(totals: TokenUsage, round: TokenUsage | undefined): void {
  if (round === undefined) return
  for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens', 'cachedTokens'] as const) {
    const value = round[key]
    if (value === undefined) continue
    totals[key] = (totals[key] ?? 0) + value
  }
}

/** A provider that reported nothing must not be recorded as having reported zero. */
function hasUsage(totals: TokenUsage): boolean {
  return Object.values(totals).some((value) => value !== undefined)
}

/** A tool that never ran, described so the model can act on it. */
function refused(
  identity: { callId: string; name: string; arguments: string },
  message: string,
  source = 'unknown',
): ToolStep {
  return {
    callId: identity.callId,
    source,
    name: identity.name,
    arguments: identity.arguments,
    text: message,
    isError: true,
    truncated: false,
  }
}

/** How a turn ended. Exactly one of these reaches the terminal write. */
type Outcome =
  | { kind: 'complete'; text: string; reasoning: string; items?: unknown[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: string }

type Active = {
  conversationId: string
  controller: AbortController
}

type Selection = {
  provider: ProviderConfig
  model: string
  /** Effective window: what the user typed, else what the server reported. */
  contextTokens?: number
  sampling: ModelSlots[Mode]['sampling']
}

/** The window to plan against, in order of how much it is actually known. */
function effectiveContext(slot: ModelSlots[Mode]): number | undefined {
  return slot.contextTokens ?? slot.detectedContextTokens
}

function selection(conversation: Conversation, d: Deps): Result<Selection> {
  const slot = d.slots()[conversation.mode]
  if (slot.providerId === null) {
    return err('chat/no-provider', 'conversation mode has no provider')
  }
  if (slot.model.trim() === '') return err('chat/no-model', 'conversation mode has no model')
  const provider = d.getProvider(slot.providerId)
  if (provider === undefined) return err('chat/no-provider', 'configured provider was not found')
  const context = effectiveContext(slot)
  return ok({
    provider,
    model: slot.model,
    // A typed override wins over discovery; discovery wins over Luna's guess.
    ...(context === undefined ? {} : { contextTokens: context }),
    sampling: slot.sampling,
  })
}

export class ChatCoordinator {
  private readonly active = new Map<string, Active>()
  private readonly background = new Set<AbortController>()
  private readonly starting = new Set<string>()
  private readonly running = new Set<Promise<void>>()

  constructor(private readonly d: Deps) {}

  async send(input: unknown): Promise<Result<ChatStart>> {
    const req = object(input)
    const conversationId = id(req?.conversationId)
    const message = text(req?.text, 100_000)
    const selectedAttachments = attachmentIds(req?.attachmentIds)
    if (
      conversationId === undefined ||
      message === undefined ||
      selectedAttachments === undefined ||
      (message === '' && selectedAttachments.length === 0)
    ) {
      return err('chat/invalid', 'chat message was invalid')
    }

    const conversation = this.d.getChat(conversationId)
    if (conversation === undefined) return err('chat/missing', 'conversation was not found')
    if (this.isBusy(conversationId)) return err('chat/busy', 'conversation already has an active response')
    const selected = selection(conversation, this.d)
    if (!selected.ok) return selected

    let apiKey: string | undefined
    this.starting.add(conversationId)
    try {
      apiKey = await this.d.readKey(selected.value.provider.id)
    } catch {
      this.starting.delete(conversationId)
      return err('secret/unavailable', 'secure credential read failed')
    }

    const userMessageId = this.d.newId()
    const assistantMessageId = this.d.newId()
    let turn: Turn | undefined
    try {
      turn = this.d.begin(
        conversationId,
        message,
        userMessageId,
        assistantMessageId,
        this.d.now(),
        selectedAttachments,
      )
    } finally {
      this.starting.delete(conversationId)
    }
    if (turn === undefined) return err('chat/invalid-attachments', 'chat attachments were invalid')

    this.launch(conversationId, assistantMessageId, selected.value, apiKey)
    return ok({ ...turn })
  }

  async retry(input: unknown): Promise<Result<undefined>> {
    const messageId = id(object(input)?.messageId)
    if (messageId === undefined) return err('chat/invalid', 'message id was invalid')
    const conversationId = this.d.retryTarget(messageId)
    if (conversationId === undefined) {
      return err('chat/not-retryable', 'message cannot be retried')
    }
    const conversation = this.d.getChat(conversationId)
    if (conversation === undefined) return err('chat/missing', 'conversation was not found')
    if (this.isBusy(conversationId)) return err('chat/busy', 'conversation already has an active response')
    const selected = selection(conversation, this.d)
    if (!selected.ok) return selected

    let apiKey: string | undefined
    this.starting.add(conversationId)
    try {
      try {
        apiKey = await this.d.readKey(selected.value.provider.id)
      } catch {
        return err('secret/unavailable', 'secure credential read failed')
      }
      if (this.d.restart(messageId, this.d.now()) === undefined) {
        return err('chat/not-retryable', 'message cannot be retried')
      }
    } finally {
      this.starting.delete(conversationId)
    }

    this.launch(conversationId, messageId, selected.value, apiKey)
    return ok(undefined)
  }

  cancel(input: unknown): Result<undefined> {
    const req = object(input)
    const messageId = id(req?.messageId)
    if (messageId === undefined) return err('chat/invalid', 'message id was invalid')
    const active = this.active.get(messageId)
    if (active === undefined) return err('chat/not-active', 'message is not streaming')
    active.controller.abort()
    return ok(undefined)
  }

  cancelConversation(conversationId: string): void {
    for (const active of this.active.values()) {
      if (active.conversationId === conversationId) active.controller.abort()
    }
  }

  stopAll(): void {
    for (const active of this.active.values()) active.controller.abort()
    for (const controller of this.background) controller.abort()
  }

  /**
   * Resolves once every launched turn has finished unwinding. Aborting a
   * controller only starts that: the turn still writes its terminal row
   * afterwards, and a caller about to close the database has to wait for it.
   */
  async settle(): Promise<void> {
    // Looped rather than awaited once: a turn launches its auto-title job while
    // it is still running, so a single snapshot can miss the job it spawns.
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running])
    }
  }

  /** Runs a launched turn, tracked so `settle` can wait for it. */
  private track(work: Promise<void>): void {
    const task = work.catch(() => undefined).finally(() => this.running.delete(task))
    this.running.add(task)
  }

  private isBusy(conversationId: string): boolean {
    return (
      this.starting.has(conversationId) ||
      [...this.active.values()].some((item) => item.conversationId === conversationId)
    )
  }

  private launch(
    conversationId: string,
    messageId: string,
    selected: Selection,
    apiKey: string | undefined,
  ): void {
    const controller = new AbortController()
    this.active.set(messageId, { conversationId, controller })
    this.d.notifyChats(this.d.list())
    this.track(this.prepare(conversationId, messageId, selected, apiKey, controller))
  }

  private async prepare(
    conversationId: string,
    messageId: string,
    selected: Selection,
    apiKey: string | undefined,
    controller: AbortController,
  ): Promise<void> {
    let history: StoredMessage[]
    try {
      history = await this.d.history(conversationId)
    } catch {
      this.active.delete(messageId)
      const message = this.d.finish(messageId, '', '', 'error', this.d.now())
      if (message !== undefined) this.d.notifyError(conversationId, message, 'attachment/io')
      this.d.notifyChats(this.d.list())
      return
    }
    // Snapshotted once, alongside the history read: enabling a tool while this
    // turn is in flight must not change what this turn can reach.
    const catalog = await this.d.toolCatalog(controller.signal)
    const plan = planHistory(
      history.map(sizeOf),
      historyBudget(selected.contextTokens ?? DEFAULT_CONTEXT_TOKENS),
    )
    const request: ChatRequest = {
      provider: selected.provider,
      ...(apiKey === undefined ? {} : { apiKey }),
      model: selected.model,
      systemPrompt: LUNA_SYSTEM_PROMPT,
      history: plan.from === 0 ? history : history.slice(plan.from),
      sampling: selected.sampling,
      ...(catalog.length === 0
        ? {}
        : { tools: catalog.map((tool) => tool.definition) }),
    }
    await this.run(
      conversationId,
      messageId,
      request,
      controller,
      this.d.prefs().stream,
      catalog,
      plan.trimmed,
    )
  }

  /**
   * Runs one assistant turn to completion.
   *
   * A turn is a bounded loop, not a single request: the model may answer, or it
   * may ask for tools, see their results, and be asked again. Whatever happens,
   * the row is finalized exactly once — the loop body never calls `finish`, so
   * there is only one terminal write, after the loop.
   */
  private async run(
    conversationId: string,
    messageId: string,
    request: ChatRequest,
    controller: AbortController,
    showStream: boolean,
    catalog: readonly ToolInfo[],
    trimmed: boolean,
  ): Promise<void> {
    /** Text from rounds already finished. The live round is appended to it. */
    let committedText = ''
    let committedReasoning = ''
    /**
     * The round currently streaming, on its own. Kept separate from the
     * committed prefix so a round that fails before emitting any delta still
     * reports everything the earlier rounds produced.
     */
    let roundText = ''
    let roundReasoning = ''
    // Monotonic for the whole row, never reset per round: the renderer discards
    // any delta whose seq is not greater than the last one it applied.
    let seq = 0
    const rounds: StoredToolRound[] = []
    const totals: TokenUsage = {}
    let calls = 0
    let outcome: Outcome | undefined
    let current = request

    const onDelta = (chunk: { text: string; reasoning: string }): void => {
      const parsed = parseThinkingTags(chunk.text)
      roundText = parsed.text
      roundReasoning = combineReasoning(chunk.reasoning, parsed.reasoning)
      if (!showStream) return
      seq += 1
      this.d.notifyDelta({
        conversationId,
        messageId,
        text: joinText(committedText, roundText),
        reasoning: joinText(committedReasoning, roundReasoning),
        seq,
      })
    }

    try {
      for (let round = 0; round < MAX_TOOL_ITERATIONS; round += 1) {
        if (controller.signal.aborted) {
          outcome = { kind: 'cancelled' }
          break
        }
        roundText = ''
        roundReasoning = ''

        const result = await this.d.stream(current, controller.signal, onDelta)
        if (!result.ok) {
          outcome =
            result.code === 'chat/cancelled'
              ? { kind: 'cancelled' }
              : { kind: 'error', code: result.code }
          break
        }
        addUsage(totals, result.value.usage)

        const requested = result.value.toolCalls ?? []
        const parsed = parseThinkingTags(result.value.text, true)
        const reasoning = combineReasoning(result.value.reasoning, parsed.reasoning)
        roundText = parsed.text
        roundReasoning = reasoning

        if (requested.length === 0) {
          outcome = {
            kind: 'complete',
            text: joinText(committedText, parsed.text),
            reasoning: joinText(committedReasoning, reasoning),
            ...(result.value.providerItems === undefined
              ? {}
              : { items: result.value.providerItems }),
          }
          break
        }

        if (calls + requested.length > MAX_TOOL_CALLS_PER_TURN) {
          outcome = { kind: 'error', code: 'chat/tool-call-limit' }
          break
        }
        calls += requested.length

        const steps = await this.dispatch(requested, catalog, controller.signal)
        rounds.push({
          text: parsed.text,
          steps,
          ...(result.value.providerItems === undefined
            ? {}
            : { providerItems: result.value.providerItems }),
        })
        // Everything this round produced is now settled, so it becomes the
        // prefix the next round's live text is appended to.
        committedText = joinText(committedText, parsed.text)
        committedReasoning = joinText(committedReasoning, reasoning)
        current = { ...request, pendingRounds: rounds }
      }
      // Falling out of the loop without an outcome means the cap was reached.
      outcome ??= { kind: 'error', code: 'chat/tool-loop-limit' }
    } finally {
      // Deregistering here rather than after the first stream keeps Stop working
      // for the whole turn, including while a tool is running.
      this.active.delete(messageId)
    }

    this.settleTurn(conversationId, messageId, current, outcome, {
      rounds,
      totals,
      seq,
      showStream,
      trimmed,
      partial: joinText(committedText, roundText),
      partialReasoning: joinText(committedReasoning, roundReasoning),
    })
  }

  /**
   * Runs one round's calls and reports what each produced.
   *
   * Never throws and never ends the turn. A denied, unknown, or failing tool
   * becomes a step the model is told about, so it can apologize, try different
   * arguments, or route around the tool.
   */
  private async dispatch(
    requested: readonly StreamToolCall[],
    catalog: readonly ToolInfo[],
    signal: AbortSignal,
  ): Promise<ToolStep[]> {
    const steps: ToolStep[] = []
    for (const call of requested) {
      const identity = { callId: call.callId, name: call.name, arguments: call.arguments }
      const entry = catalog.find((tool) => tool.definition.name === call.name)
      if (entry === undefined) {
        const available = catalog.map((tool) => tool.definition.name).join(', ')
        steps.push(
          refused(identity, `No tool named ${call.name} is available. Enabled: ${available || 'none'}.`),
        )
        continue
      }

      if (signal.aborted) {
        steps.push(refused(identity, 'The turn was stopped before this tool ran.', entry.source))
        continue
      }

      if (entry.policy === 'ask') {
        const answer = await this.d.approve(
          { sourceLabel: entry.sourceLabel, definition: entry.definition, arguments: call.arguments },
          signal,
        )
        if (answer === 'deny') {
          steps.push(
            refused(identity, 'The user declined to run this tool.', entry.source),
          )
          continue
        }
        // Only a native prompt can create standing permission; the renderer has
        // no path to this.
        if (answer === 'always') this.d.allowAlways(entry.source, entry.definition.name, this.d.now())
      }

      const outcome = await this.d.callTool(entry.source, call, signal)
      steps.push(outcome.step)
    }
    return steps
  }

  /** The single terminal write for a turn, plus everything that follows it. */
  private settleTurn(
    conversationId: string,
    messageId: string,
    request: ChatRequest,
    outcome: Outcome,
    state: {
      rounds: StoredToolRound[]
      totals: TokenUsage
      seq: number
      showStream: boolean
      trimmed: boolean
      partial: string
      partialReasoning: string
    },
  ): void {
    const shared = {
      ...(state.rounds.length === 0 ? {} : { toolRounds: state.rounds }),
      ...(state.trimmed ? { trimmed: true } : {}),
      ...(hasUsage(state.totals) ? { usage: state.totals } : {}),
    }

    if (outcome.kind === 'complete') {
      if (!state.showStream && (outcome.text !== '' || outcome.reasoning !== '')) {
        this.d.notifyDelta({
          conversationId,
          messageId,
          text: outcome.text,
          reasoning: outcome.reasoning,
          seq: state.seq + 1,
        })
      }
      const message = this.d.finish(
        messageId,
        outcome.text,
        outcome.reasoning,
        'complete',
        this.d.now(),
        {
          providerApi: request.provider.api,
          providerId: request.provider.id,
          ...(outcome.items === undefined ? {} : { items: outcome.items }),
          ...shared,
        },
      )
      if (message !== undefined) {
        this.d.notifyDone(conversationId, message)
        if (this.d.prefs().autoTitle) {
          const first = request.history.find((item) => item.role === 'user')
          const firstUser = first?.text !== '' ? first?.text : first?.attachments[0]?.name
          if (firstUser !== undefined) {
            this.track(this.title(conversationId, firstUser, outcome.text))
          }
        }
      }
      this.d.notifyChats(this.d.list())
      return
    }

    const cancelled = outcome.kind === 'cancelled'
    // A turn that ran three tools and then failed should still show what it did
    // and what it cost, so the rounds and usage are written either way.
    const message = this.d.finish(
      messageId,
      state.partial,
      state.partialReasoning,
      cancelled ? 'cancelled' : 'error',
      this.d.now(),
      shared,
    )
    if (message !== undefined) {
      if (cancelled) this.d.notifyDone(conversationId, message)
      else this.d.notifyError(conversationId, message, outcome.code)
    }
    this.d.notifyChats(this.d.list())
  }

  private async title(
    conversationId: string,
    userText: string,
    assistantText: string,
  ): Promise<void> {
    if (this.d.getChat(conversationId)?.title !== 'New chat') return
    const slot = this.d.slots().fast
    if (slot.providerId === null || slot.model.trim() === '') return
    const provider = this.d.getProvider(slot.providerId)
    if (provider === undefined) return

    let apiKey: string | undefined
    try {
      apiKey = await this.d.readKey(provider.id)
    } catch {
      return
    }
    const controller = new AbortController()
    this.background.add(controller)
    const result = await this.d.stream(
      {
        provider,
        ...(apiKey === undefined ? {} : { apiKey }),
        model: slot.model,
        systemPrompt:
          'Write a concise title of at most six words for this conversation. Return only the title, with no quotation marks or punctuation.',
        history: [
          {
            id: 'title-input',
            role: 'user',
            text: `User:\n${userText}\n\nAssistant:\n${assistantText}`,
            status: 'complete',
            at: this.d.now(),
            attachments: [],
          },
        ],
        sampling: slot.sampling,
      },
      controller.signal,
      () => undefined,
    )
    this.background.delete(controller)
    if (!result.ok || this.d.getChat(conversationId)?.title !== 'New chat') return
    const title = result.value.text
      .split(/\r?\n/, 1)[0]
      ?.replace(/^(?:title\s*:\s*)/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    if (title === undefined || title === '') return
    if (this.d.setTitle(conversationId, title) !== undefined) this.d.notifyChats(this.d.list())
  }
}

export const coordinator = new ChatCoordinator(deps)

export function register(): void {
  handle('chat:send', (_event, req) => coordinator.send(req))
  handle('chat:cancel', (_event, req) => coordinator.cancel(req))
}
