/**
 * The single source of truth for every renderer <-> main message.
 *
 * Adding a feature means adding a line here. The compiler then reports the
 * missing handler in src/main/ipc and the missing wrapper in src/preload.
 */

import type { Prefs } from './prefs.js'
import type {
  Conversation,
  Message,
  ModelSlots,
  Mode,
  Provider,
  ProviderDraft,
  ProviderModel,
} from './types.js'

export type ChatStart = {
  conversation: Conversation
  userMessageId: string
  assistantMessageId: string
}

export type ChatDelta = {
  conversationId: string
  messageId: string
  /** Full text accumulated so far, making reordered events safe to ignore. */
  text: string
  /** Full explicit <think> content accumulated so far. */
  reasoning: string
  seq: number
}

export type ChatFinal = {
  conversationId: string
  message: Message
}

export type ChatFailure = ChatFinal & { code: string }

export type AppInfo = {
  name: string
  version: string
  electron: string
  platform: string
}

/** Two-way. Renderer asks, main answers. ipcRenderer.invoke / ipcMain.handle. */
export type Invocations = {
  'app:info': { req: undefined; res: AppInfo }
  'prefs:get': { req: undefined; res: Prefs }
  'prefs:set': { req: Prefs; res: Prefs }
  'providers:list': { req: undefined; res: Provider[] }
  'providers:create': { req: ProviderDraft; res: Provider }
  'providers:update': { req: { id: string; provider: ProviderDraft }; res: Provider }
  'providers:delete': { req: { id: string }; res: undefined }
  'providers:set-key': { req: { id: string; apiKey: string | null }; res: Provider }
  'providers:models': { req: { id: string }; res: ProviderModel[] }
  'models:get': { req: undefined; res: ModelSlots }
  'models:set': {
    req: { slot: Mode; providerId: string | null; model: string }
    res: ModelSlots
  }
  'chats:list': { req: undefined; res: Conversation[] }
  'chats:create': { req: { mode: Mode }; res: Conversation }
  'chats:set-mode': { req: { id: string; mode: Mode }; res: Conversation }
  'chats:set-draft': { req: { id: string; draft: string }; res: undefined }
  'chats:set-pinned': { req: { id: string; pinned: boolean }; res: Conversation }
  'chats:delete': { req: { id: string }; res: undefined }
  'chat:send': { req: { conversationId: string; text: string }; res: ChatStart }
  'chat:cancel': { req: { messageId: string }; res: undefined }
  'messages:menu': { req: { id: string }; res: undefined }
  'settings:open': { req: undefined; res: undefined }
}

/** One-way, main -> renderer. webContents.send / ipcRenderer.on. */
export type Events = {
  'shortcut:new-chat': undefined
  'shortcut:command-palette': undefined
  'theme:changed': { dark: boolean }
  /** Sent to every window after a successful write. Carries the stored set. */
  'prefs:changed': Prefs
  /** Non-secret provider configuration changed. */
  'providers:changed': Provider[]
  /** Fast or Expert was assigned to a different provider/model pair. */
  'models:changed': ModelSlots
  'chats:changed': Conversation[]
  'chat:delta': ChatDelta
  'chat:done': ChatFinal
  'chat:error': ChatFailure
}

export type Channel = keyof Invocations
export type Req<C extends Channel> = Invocations[C]['req']
export type Res<C extends Channel> = Invocations[C]['res']

export type EventName = keyof Events
export type EventData<E extends EventName> = Events[E]
