/**
 * Primitives for parsing untrusted values — IPC payloads and SQLite rows.
 * A value is unknown until proven otherwise; each function returns undefined
 * instead of guessing.
 */

export function object(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null ? { ...input } : undefined
}

/** The shape of every id Luna generates or accepts: uuids and provider ids. */
export function id(input: unknown): string | undefined {
  return typeof input === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(input) ? input : undefined
}

/** Trimmed text under a bound. Empty is allowed; callers reject it where needed. */
export function text(input: unknown, max: number): string | undefined {
  if (typeof input !== 'string') return undefined
  const value = input.trim()
  return value.length <= max ? value : undefined
}
