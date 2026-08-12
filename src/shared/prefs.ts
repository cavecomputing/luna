/**
 * User preferences. Pure — the shape, the defaults, and the parser that turns
 * whatever is on disk into a value we can trust.
 *
 * Secrets never live here. API keys go to the Keychain via safeStorage in main
 * and are not part of prefs, which is a set of rows in the SQLite database.
 */

export type Theme = 'luna-light' | 'luna-dark' | 'gruvbox-light' | 'gruvbox-dark'

export type Prefs = {
  theme: Theme
  /** Start new conversations in this mode. */
  defaultMode: 'fast' | 'expert'
  /** Name a conversation from its first exchange using the Fast model. */
  autoTitle: boolean
  /** Stream assistant replies token by token. */
  stream: boolean
  /** Last expanded width of the conversation sidebar, in CSS pixels. */
  sidebarWidth: number
}

export const defaultPrefs: Prefs = {
  theme: 'luna-light',
  defaultMode: 'fast',
  autoTitle: true,
  stream: true,
  sidebarWidth: 264,
}

/** Bounds for the resizable conversation sidebar, shared with its parser. */
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 420

const themes: Theme[] = ['luna-light', 'luna-dark', 'gruvbox-light', 'gruvbox-dark']
const modes: Prefs['defaultMode'][] = ['fast', 'expert']

/**
 * Theme names from before themes had families. Rows written by an older build
 * (or a legacy prefs.json folded in by adoptLegacy) still land on their
 * named equivalent; 'system' is gone, so it settles on the default.
 */
const legacyThemes = new Map<string, Theme>([
  ['light', 'luna-light'],
  ['dark', 'luna-dark'],
  ['system', 'luna-light'],
])

/**
 * Never casts. A corrupt or hand-edited file falls back field by field, so one
 * bad value doesn't wipe the rest of the user's settings.
 */
export function parsePrefs(input: unknown): Prefs {
  if (typeof input !== 'object' || input === null) return { ...defaultPrefs }
  const raw: Record<string, unknown> = { ...input }

  return {
    theme: theme(raw.theme),
    defaultMode: pick(raw.defaultMode, modes, defaultPrefs.defaultMode),
    autoTitle: bool(raw.autoTitle, defaultPrefs.autoTitle),
    stream: bool(raw.stream, defaultPrefs.stream),
    sidebarWidth: range(
      raw.sidebarWidth,
      SIDEBAR_MIN_WIDTH,
      SIDEBAR_MAX_WIDTH,
      defaultPrefs.sidebarWidth,
    ),
  }
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback
}

function theme(value: unknown): Theme {
  if (typeof value === 'string') {
    const mapped = legacyThemes.get(value)
    if (mapped !== undefined) return mapped
  }
  return pick(value, themes, defaultPrefs.theme)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function range(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback
}
