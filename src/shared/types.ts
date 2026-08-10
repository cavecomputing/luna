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

export type ModelSlot = {
  providerId: string | null
  model: string
}

export type ModelSlots = Record<Mode, ModelSlot>

export type Role = 'user' | 'assistant'

export type Message = {
  id: string
  role: Role
  text: string
  /** Epoch milliseconds. Formatting is the renderer's job. */
  at: number
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
  icon: ChatIcon
  mode: Mode
  /** Pinned conversations sort ahead of unpinned conversations. */
  pinned?: boolean
  /** Epoch milliseconds of the most recent message. */
  updatedAt: number
  messages: Message[]
}
