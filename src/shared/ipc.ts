/**
 * The single source of truth for every renderer <-> main message.
 *
 * Adding a feature means adding a line here. The compiler then reports the
 * missing handler in src/main/ipc and the missing wrapper in src/preload.
 */

import type { McpServerDraft, McpServerInfo } from './mcp.js'
import type { Prefs } from './prefs.js'
import type { ToolInfo } from './tools.js'
import type {
  AttachmentMeta,
  ConversationSummary,
  SearchHit,
  Message,
  ModelSlots,
  Mode,
  Provider,
  ProviderDraft,
  ProviderModel,
  SamplerSettings,
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

/** Logical attachment bytes in the active database, excluding backup copies. */
export type AttachmentStorage = {
  totalBytes: number
  totalCount: number
  sentBytes: number
  sentCount: number
  unsentBytes: number
  unsentCount: number
}

export type AttachmentCleanup = {
  removedBytes: number
  removedCount: number
}

export type ChatStart = {
  conversation: ConversationSummary
  userMessageId: string
  assistantMessageId: string
  /** The two rows persisted for this turn, so the open thread can paint immediately. */
  messages: Message[]
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
  /** Null clears the override and returns the slot to Luna's default estimate. */
  'models:set-context': {
    req: { slot: Mode; contextTokens: number | null }
    res: ModelSlots
  }
  'models:set-sampling': {
    req: { slot: Mode; sampling: SamplerSettings }
    res: ModelSlots
  }
  /** Connects to every tool source and returns the catalog with its grants. */
  'tools:list': { req: undefined; res: ToolInfo[] }
  'tools:set-enabled': { req: { source: string; name: string; enabled: boolean }; res: ToolInfo[] }
  /**
   * Asks main to grant standing permission. Main confirms natively first, so
   * the renderer requests the grant but never creates it.
   */
  'tools:allow-always': { req: { source: string; name: string }; res: ToolInfo[] }
  /** Revokes standing permission so an enabled tool asks before every call. */
  'tools:require-approval': { req: { source: string; name: string }; res: ToolInfo[] }
  /** Configured MCP servers with their live status. Never their credentials. */
  'mcp:list': { req: undefined; res: McpServerInfo[] }
  /** Creates a server, switched off. Enabling it is a separate, confirmed step. */
  'mcp:create': { req: McpServerDraft; res: McpServerInfo }
  'mcp:update': { req: { id: string; server: McpServerDraft }; res: McpServerInfo }
  'mcp:delete': { req: { id: string }; res: undefined }
  /**
   * Asks main to start or stop running a server. Turning one on means executing
   * a program, so main confirms natively first — the renderer requests it and
   * never decides it. A cancelled prompt succeeds with the server still off.
   */
  'mcp:set-enabled': { req: { id: string; enabled: boolean }; res: McpServerInfo }
  /**
   * Stores the variables a server is launched with. Null clears them.
   *
   * Values travel renderer to main once and are never sent back; the renderer
   * only ever learns whether something is stored.
   */
  'mcp:set-env': {
    req: { id: string; values: Record<string, string> | null }
    res: McpServerInfo
  }
  /** Drops a live connection and tries the server again now, ignoring cooldown. */
  'mcp:restart': { req: { id: string }; res: McpServerInfo }
  /** Titles and timestamps only. Message bodies come from chats:messages. */
  'chats:list': { req: undefined; res: ConversationSummary[] }
  /** The messages of one conversation, loaded when it is opened. */
  'chats:messages': { req: { id: string }; res: Message[] }
  /** Searches titles and message text in SQLite rather than in the renderer. */
  'chats:search': { req: { query: string }; res: SearchHit[] }
  'chats:create': { req: { mode: Mode }; res: ConversationSummary }
  'chats:set-mode': { req: { id: string; mode: Mode }; res: ConversationSummary }
  'chats:set-draft': { req: { id: string; draft: string }; res: undefined }
  'chats:set-pinned': { req: { id: string; pinned: boolean }; res: ConversationSummary }
  'chats:rename': { req: { id: string; title: string }; res: ConversationSummary }
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
  'attachments:storage': { req: undefined; res: AttachmentStorage }
  'attachments:clear-unsent': { req: undefined; res: AttachmentCleanup }
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
  'privacy:export': { req: undefined; res: { written: number } }
  'privacy:delete-all': { req: undefined; res: { deleted: boolean } }
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
  /** A tool was enabled, disabled, or re-discovered with a changed definition. */
  'tools:changed': ToolInfo[]
  /** A server was added, edited, removed, or changed what it is doing. */
  'mcp:changed': McpServerInfo[]
  'chats:changed': ConversationSummary[]
  'attachments:changed': { conversationId: string; attachments: AttachmentMeta[] }
  /** Attachment rows changed; Settings reloads worker-computed storage totals. */
  'attachments:storage-changed': undefined
  'chat:delta': ChatDelta
  'chat:done': ChatFinal
  'chat:error': ChatFailure
}

export type Channel = keyof Invocations
export type Req<C extends Channel> = Invocations[C]['req']
export type Res<C extends Channel> = Invocations[C]['res']

export type EventName = keyof Events
export type EventData<E extends EventName> = Events[E]
