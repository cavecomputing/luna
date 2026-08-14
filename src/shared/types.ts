/** Domain types. Pure TypeScript — imported by main, preload and renderer alike. */

/** Per-conversation model choice. Shown as the Fast / Expert switch. */
export type Mode = 'fast' | 'expert'

/** The two OpenAI-compatible request surfaces Luna can target. */
export type ApiKind = 'responses' | 'chat-completions'

/** Non-secret provider configuration. Credentials never appear in this type. */
export type Provider = {
  id: string
  name: string
  baseUrl: string
  api: ApiKind
  organization: string
  project: string
  hasApiKey: boolean
}

export type ProviderDraft = Omit<Provider, 'id' | 'hasApiKey'>

/** Basic model metadata returned by the OpenAI-compatible GET /models route. */
export type ProviderModel = {
  id: string
  ownedBy?: string
  created?: number
}

/** Optional request-level sampling overrides for one model slot. */
export type SamplerSettings = {
  enabled: boolean
  temperature: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
  seed: number | null
  /** OpenAI-compatible server extensions. Omitted when null. */
  topK: number | null
  minP: number | null
  repeatPenalty: number | null
}

export const defaultSamplerSettings: SamplerSettings = {
  enabled: false,
  temperature: 0.7,
  topP: 0.95,
  frequencyPenalty: 0,
  presencePenalty: 0,
  seed: null,
  topK: null,
  minP: null,
  repeatPenalty: null,
}

export type ModelSlot = {
  providerId: string | null
  model: string
  sampling: SamplerSettings
}

export type ModelSlots = Record<Mode, ModelSlot>

/** Both slots unassigned — the shape a fresh install starts from. */
export const emptyModelSlots: ModelSlots = {
  fast: { providerId: null, model: '', sampling: { ...defaultSamplerSettings } },
  expert: { providerId: null, model: '', sampling: { ...defaultSamplerSettings } },
}

export type Role = 'user' | 'assistant'

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'cancelled'

export type AttachmentKind = 'image' | 'text' | 'pdf'

export type AttachmentMeta = {
  id: string
  name: string
  kind: AttachmentKind
  mediaType: string
  size: number
}

export type Message = {
  id: string
  role: Role
  text: string
  /** Explicit <think> content from compatible models, separate from the answer. */
  reasoning?: string
  status: MessageStatus
  /** Renderer-only ordering guard for streamed updates. Never persisted. */
  streamSeq?: number
  /** Epoch milliseconds. Formatting is the renderer's job. */
  at: number
  attachments: AttachmentMeta[]
}

/**
 * Names a conversation's list icon. A closed set rather than a free string so
 * a bad value is a compile error, not a blank square at runtime.
 */
export type ChatIcon =
  | 'wave'
  | 'bowl'
  | 'book'
  | 'dumbbell'
  | 'leaf'
  | 'gift'
  | 'camera'
  | 'spark'

export type Conversation = {
  id: string
  title: string
  /** Unsent composer text, persisted separately for each conversation. */
  draft: string
  icon: ChatIcon
  mode: Mode
  /** Pinned conversations sort ahead of unpinned conversations. */
  pinned: boolean
  /** Epoch milliseconds of the most recent message. */
  updatedAt: number
  messages: Message[]
}
