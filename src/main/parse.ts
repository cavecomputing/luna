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

/**
 * A tool's name, which is not one of our ids.
 *
 * The Model Context Protocol allows dots and up to 128 characters, so `id()`
 * would quietly reject legitimate names like `admin.tools.list`. `id()` keeps
 * its narrower shape because it also guards filesystem paths in secrets.ts —
 * widening it there would be a security change, not a convenience.
 */
export function toolName(input: unknown): string | undefined {
  return typeof input === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(input) ? input : undefined
}

/**
 * An array whose every entry parses. One bad entry rejects the whole array
 * rather than being skipped, for callers where a partial list is worse than
 * none — a tool result without its call, say.
 */
export function array<T>(input: unknown, each: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out: T[] = []
  for (const item of input) {
    const parsed = each(item)
    if (parsed === undefined) return undefined
    out.push(parsed)
  }
  return out
}

/** A string-keyed map whose every value parses, with the same all-or-nothing rule. */
export function record<T>(
  input: unknown,
  each: (value: unknown) => T | undefined,
): Record<string, T> | undefined {
  const cell = object(input)
  if (cell === undefined) return undefined
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(cell)) {
    const parsed = each(value)
    if (parsed === undefined) return undefined
    out[key] = parsed
  }
  return out
}
