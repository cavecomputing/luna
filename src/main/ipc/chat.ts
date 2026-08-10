import { net } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Prefs } from '../../shared/prefs.js'
import { err, ok, type Result } from '../../shared/result.js'
import type { ChatStart } from '../../shared/ipc.js'
import type { ApiKind, Conversation, Message, ModelSlots } from '../../shared/types.js'
import { parseThinkingTags } from '../../shared/thinking.js'
import { streamChat, type ChatCompletion, type ChatRequest } from '../chat-api.js'
import * as chats from '../chats.js'
import type { StoredMessage, Turn } from '../chats.js'
import * as db from '../db.js'
import * as prefs from '../prefs.js'
import * as providers from '../providers.js'
import type { ProviderConfig } from '../providers.js'
import * as secrets from '../secrets.js'
import { broadcast, handle } from './bus.js'

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
  ) => Turn | undefined
  history: (conversationId: string) => StoredMessage[]
  finish: (
    id: string,
    text: string,
    reasoning: string,
    status: 'complete' | 'error' | 'cancelled',
    now: number,
    api?: ApiKind,
    providerId?: string,
    items?: unknown[],
  ) => Message | undefined
  setTitle: (id: string, title: string) => Conversation | undefined
  list: () => Conversation[]
  stream: (
    request: ChatRequest,
    signal: AbortSignal,
    onDelta: (text: string) => void,
  ) => Promise<Result<ChatCompletion>>
  newId: () => string
  now: () => number
  notifyChats: (chats: Conversation[]) => void
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
  begin: (conversationId, text, userId, assistantId, now) =>
    chats.beginTurn(db.handle(), conversationId, text, userId, assistantId, now),
  history: chats.transcript,
  finish: (id, text, reasoning, status, now, api, providerId, items) =>
    chats.finishMessage(db.handle(), id, text, reasoning, status, now, api, providerId, items),
  setTitle: (id, title) => chats.setTitle(db.handle(), id, title),
  list: chats.load,
  stream: (request, signal, onDelta) =>
    streamChat(request, signal, onDelta, (input, init) => net.fetch(input, init)),
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

function object(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null ? { ...input } : undefined
}

function id(input: unknown): string | undefined {
  return typeof input === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(input)
    ? input
    : undefined
}

function messageText(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const value = input.trim()
  return value !== '' && value.length <= 100_000 ? value : undefined
}

type Active = {
  conversationId: string
  controller: AbortController
}

export class ChatCoordinator {
  private readonly active = new Map<string, Active>()
  private readonly background = new Set<AbortController>()
  private readonly starting = new Set<string>()

  constructor(private readonly d: Deps) {}

  async send(input: unknown): Promise<Result<ChatStart>> {
    const req = object(input)
    const conversationId = id(req?.conversationId)
    const text = messageText(req?.text)
    if (conversationId === undefined || text === undefined) {
      return err('chat/invalid', 'chat message was invalid')
    }

    const conversation = this.d.getChat(conversationId)
    if (conversation === undefined) return err('chat/missing', 'conversation was not found')
    if (
      this.starting.has(conversationId) ||
      [...this.active.values()].some((item) => item.conversationId === conversationId)
    ) {
      return err('chat/busy', 'conversation already has an active response')
    }

    const slot = this.d.slots()[conversation.mode]
    if (slot.providerId === null) {
      return err('chat/no-provider', 'conversation mode has no provider')
    }
    if (slot.model.trim() === '') return err('chat/no-model', 'conversation mode has no model')
    const provider = this.d.getProvider(slot.providerId)
    if (provider === undefined) return err('chat/no-provider', 'configured provider was not found')

    let apiKey: string | undefined
    this.starting.add(conversationId)
    try {
      apiKey = await this.d.readKey(provider.id)
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
        text,
        userMessageId,
        assistantMessageId,
        this.d.now(),
      )
    } finally {
      this.starting.delete(conversationId)
    }
    if (turn === undefined) return err('chat/missing', 'conversation was not found')

    const controller = new AbortController()
    this.active.set(assistantMessageId, { conversationId, controller })
    this.d.notifyChats(this.d.list())
    const request: ChatRequest = {
      provider,
      ...(apiKey === undefined ? {} : { apiKey }),
      model: slot.model,
      systemPrompt: this.d.prefs().systemPrompt,
      history: this.d.history(conversationId),
    }
    const showStream = this.d.prefs().stream
    void this.run(conversationId, assistantMessageId, request, controller, showStream).catch(() => {
      this.active.delete(assistantMessageId)
    })
    return ok({ ...turn })
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

  private async run(
    conversationId: string,
    messageId: string,
    request: ChatRequest,
    controller: AbortController,
    showStream: boolean,
  ): Promise<void> {
    let partial = ''
    let partialReasoning = ''
    let seq = 0
    const result = await this.d.stream(request, controller.signal, (raw) => {
      const parsed = parseThinkingTags(raw)
      partial = parsed.text
      partialReasoning = parsed.reasoning
      if (showStream) {
        seq += 1
        this.d.notifyDelta({
          conversationId,
          messageId,
          text: partial,
          reasoning: partialReasoning,
          seq,
        })
      }
    })

    this.active.delete(messageId)
    if (result.ok) {
      const parsed = parseThinkingTags(result.value.text, true)
      if (!showStream && (parsed.text !== '' || parsed.reasoning !== '')) {
        seq += 1
        this.d.notifyDelta({
          conversationId,
          messageId,
          text: parsed.text,
          reasoning: parsed.reasoning,
          seq,
        })
      }
      const message = this.d.finish(
        messageId,
        parsed.text,
        parsed.reasoning,
        'complete',
        this.d.now(),
        request.provider.api,
        request.provider.id,
        result.value.providerItems,
      )
      if (message !== undefined) {
        this.d.notifyDone(conversationId, message)
        if (this.d.prefs().autoTitle) {
          const firstUser = request.history.find((item) => item.role === 'user')?.text
          if (firstUser !== undefined) {
            void this.title(conversationId, firstUser, parsed.text).catch(() => undefined)
          }
        }
      }
    } else {
      const cancelled = result.code === 'chat/cancelled'
      const message = this.d.finish(
        messageId,
        partial,
        partialReasoning,
        cancelled ? 'cancelled' : 'error',
        this.d.now(),
      )
      if (message !== undefined) {
        if (cancelled) this.d.notifyDone(conversationId, message)
        else this.d.notifyError(conversationId, message, result.code)
      }
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
          },
        ],
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
