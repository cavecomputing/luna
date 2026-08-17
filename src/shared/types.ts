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
  /** The model's context window. Absent means use Luna's default estimate. */
  contextTokens?: number
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

/** What a tool returned besides text. The bytes stay out of the transcript. */
export type ToolPartKind = 'image' | 'audio' | 'resource' | 'resource_link'

export type ToolPartRef = {
  kind: ToolPartKind
  mediaType?: string
  /** Byte length of the part we chose not to inline. */
  size?: number
  /** Present for resource links. Server-supplied, so render it as escaped text. */
  uri?: string
}

/**
 * One tool call and its result, stored on the assistant row that made it.
 *
 * `name` is the tool's own name, unprefixed; `source` says who provides it, so
 * a grant can always be traced back even when two servers export the same name.
 */
export type ToolStep = {
  callId: string
  source: string
  name: string
  /** Argument JSON exactly as the model produced it. Not reformatted. */
  arguments: string
  /** Flattened text parts, capped. Everything else is referenced in `parts`. */
  text: string
  /** Structured result data, validated whole or dropped. Never partially kept. */
  structured?: unknown
  parts?: ToolPartRef[]
  /** A tool-reported failure, which the model is told about so it can retry. */
  isError: boolean
  truncated: boolean
}

/**
 * One model response that asked for tools, followed by those tools' results.
 *
 * Calls within a round were requested together and may run in parallel. Rounds
 * themselves are ordered: the model saw every result from one before producing
 * the next. The assistant row's own `text` remains the final answer after all
 * rounds have completed.
 */
export type ToolRound = {
  /** Visible text the model emitted alongside this round's calls. */
  text: string
  steps: ToolStep[]
}

/**
 * Tokens a turn consumed. Absent fields mean the provider reported nothing,
 * which is different from reporting zero.
 */
export type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
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
  /** Ordered model/tool rounds completed before this assistant answer. */
  toolRounds?: ToolRound[]
  /** True when history had to be left out of this turn's request. */
  trimmed?: boolean
  /** Summed across every request the turn made, not just the last one. */
  usage?: TokenUsage
}

export type Conversation = {
  id: string
  title: string
  /** Unsent composer text, persisted separately for each conversation. */
  draft: string
  mode: Mode
  /** Pinned conversations sort ahead of unpinned conversations. */
  pinned: boolean
  /** Epoch milliseconds of the most recent message. */
  updatedAt: number
  messages: Message[]
}
