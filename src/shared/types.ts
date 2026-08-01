/** Domain types. Pure TypeScript — imported by main, preload and renderer alike. */

/** Per-conversation model choice. Shown as the Fast / Expert switch. */
export type Mode = 'fast' | 'expert'

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
  /** Epoch milliseconds of the most recent message. */
  updatedAt: number
  messages: Message[]
}

/** A follow-up prompt offered under the last assistant message. */
export type Suggestion = {
  id: string
  label: string
  icon: ChatIcon
}
