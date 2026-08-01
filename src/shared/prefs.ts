/**
 * User preferences. Pure — the shape, the defaults, and the parser that turns
 * whatever is on disk into a value we can trust.
 *
 * Secrets never live here. API keys go to the Keychain via safeStorage in main
 * and are not part of prefs, which is a plain JSON file under userData.
 */

export type Theme = 'light' | 'dark' | 'system'

export type Prefs = {
  theme: Theme
  /** Start new conversations in this mode. */
  defaultMode: 'fast' | 'expert'
  /** Name a conversation from its first exchange using the Fast model. */
  autoTitle: boolean
  /** Stream assistant replies token by token. */
  stream: boolean
  /** Prepended to every conversation. Empty means none. */
  systemPrompt: string
}

export const defaultPrefs: Prefs = {
  theme: 'light',
  defaultMode: 'fast',
  autoTitle: true,
  stream: true,
  systemPrompt: '',
}

const themes: Theme[] = ['light', 'dark', 'system']
const modes: Prefs['defaultMode'][] = ['fast', 'expert']

/**
 * Never casts. A corrupt or hand-edited file falls back field by field, so one
 * bad value doesn't wipe the rest of the user's settings.
 */
export function parsePrefs(input: unknown): Prefs {
  if (typeof input !== 'object' || input === null) return { ...defaultPrefs }
  const raw: Record<string, unknown> = { ...input }

  return {
    theme: pick(raw.theme, themes, defaultPrefs.theme),
    defaultMode: pick(raw.defaultMode, modes, defaultPrefs.defaultMode),
    autoTitle: bool(raw.autoTitle, defaultPrefs.autoTitle),
    stream: bool(raw.stream, defaultPrefs.stream),
    systemPrompt: str(raw.systemPrompt, defaultPrefs.systemPrompt),
  }
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}
