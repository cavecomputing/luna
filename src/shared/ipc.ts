/**
 * The single source of truth for every renderer <-> main message.
 *
 * Adding a feature means adding a line here. The compiler then reports the
 * missing handler in src/main/ipc and the missing wrapper in src/preload.
 */

import type { Prefs } from './prefs.js'
import type {
  AttachmentMeta,
  Conversation,
  Message,
  ModelSlots,
  Mode,
  Provider,
  ProviderDraft,
  ProviderModel,
} from './types.js'

export type AttachmentInput = {
  name: string
  mediaType: string
  data: Uint8Array
}

export type AttachmentRejection = {
  name: string
  code: string
}

export type AttachmentImport = {
  accepted: AttachmentMeta[]
  rejected: AttachmentRejection[]
}

export type AttachmentBytes = {
  mediaType: string
  data: Uint8Array
}

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

export type HtmlPreviewRef = {
  id: string
  url: string
}

export type DatabaseRecoveryStatus =
  | { kind: 'corrupt'; backupCreatedAt: number }
  | { kind: 'corrupt-empty' }
  | { kind: 'migration-failed' }
  | { kind: 'newer-version' }

/** Two-way. Renderer asks, main answers. ipcRenderer.invoke / ipcMain.handle. */
export type Invocations = {
  'app:info': { req: undefined; res: AppInfo }
  'app:recover': { req: undefined; res: undefined }
  'app:close-window': { req: undefined; res: undefined }
  'app:set-modal': { req: boolean; res: undefined }
  'recovery:status': { req: undefined; res: DatabaseRecoveryStatus }
  'recovery:restore': { req: undefined; res: undefined }
  'recovery:retry': { req: undefined; res: undefined }
  'recovery:start-fresh': { req: undefined; res: undefined }
  'recovery:quit': { req: undefined; res: undefined }
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
  'chats:rename': { req: { id: string; title: string }; res: Conversation }
  'chats:delete': { req: { id: string }; res: undefined }
  'chats:menu': { req: { id: string }; res: undefined }
  'attachments:add': {
    req: { conversationId: string; files: AttachmentInput[] }
    res: AttachmentImport
  }
  'attachments:list': { req: { conversationId: string }; res: AttachmentMeta[] }
  'attachments:remove': { req: { conversationId: string; id: string }; res: undefined }
  'attachments:read': {
    req: { conversationId: string; id: string }
    res: AttachmentBytes
  }
  'chat:send': {
    req: { conversationId: string; text: string; attachmentIds: string[] }
    res: ChatStart
  }
  'chat:cancel': { req: { messageId: string }; res: undefined }
  'messages:menu': { req: { id: string }; res: undefined }
  'preview:create': { req: { html: string }; res: HtmlPreviewRef }
  'preview:release': { req: { id: string }; res: undefined }
  'settings:open': { req: undefined; res: undefined }
  'settings:close': { req: undefined; res: undefined }
}

/** One-way, main -> renderer. webContents.send / ipcRenderer.on. */
export type Events = {
  'shortcut:new-chat': undefined
  'shortcut:command-palette': undefined
  'shortcut:toggle-sidebar': undefined
  'shortcut:toggle-mode': undefined
  /** Gives Settings a chance to persist debounced fields before destruction. */
  'settings:close-requested': undefined
  'chats:rename-requested': { id: string }
  'theme:changed': { dark: boolean }
  /** Sent to every window after a successful write. Carries the stored set. */
  'prefs:changed': Prefs
  /** Non-secret provider configuration changed. */
  'providers:changed': Provider[]
  /** Fast or Expert was assigned to a different provider/model pair. */
  'models:changed': ModelSlots
  'chats:changed': Conversation[]
  'attachments:changed': { conversationId: string; attachments: AttachmentMeta[] }
  'chat:delta': ChatDelta
  'chat:done': ChatFinal
  'chat:error': ChatFailure
}

export type Channel = keyof Invocations
export type Req<C extends Channel> = Invocations[C]['req']
export type Res<C extends Channel> = Invocations[C]['res']

export type EventName = keyof Events
export type EventData<E extends EventName> = Events[E]
