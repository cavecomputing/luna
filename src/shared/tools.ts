/**
 * Tool definitions and the limits a tool loop runs under.
 *
 * Pure types and constants, imported by main and renderer alike. The bounds
 * live here rather than at their use sites so tests assert against the same
 * constant the loop enforces.
 */

/**
 * How many times one user message may bounce through the model before Luna
 * gives up. A model that keeps calling tools forever is a real failure mode and
 * an expensive one, so the turn ends with an error the user can see.
 */
export const MAX_TOOL_ITERATIONS = 8

/** Total calls one turn may make, across all iterations. */
export const MAX_TOOL_CALLS_PER_TURN = 24

/** Wall clock for a single call, enforced by the JSON-RPC peer. */
export const TOOL_CALL_TIMEOUT_MS = 30_000

/** Result text handed back to the model. An unbounded result exhausts context. */
export const MAX_TOOL_RESULT_CHARS = 65_536

/** Result text kept on the row. Transcripts are read far more often than sent. */
export const MAX_STORED_TOOL_RESULT_CHARS = 16_384

/**
 * A tool's own claims about what it does.
 *
 * Every field is a hint from the tool, which means it is attacker-controlled.
 * They exist to be shown to a person deciding whether to approve something —
 * never to decide anything in code. A tool asserting `readOnlyHint` gets the
 * same gate as one that asserts nothing.
 */
export type ToolAnnotations = {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export type ToolDefinition = {
  name: string
  /** Display name, when the tool offers one distinct from its identifier. */
  title?: string
  description: string
  /** JSON Schema. Passed to the provider as given; never trusted as code. */
  inputSchema: unknown
  outputSchema?: unknown
  annotations?: ToolAnnotations
}

/** Whether a tool may run without asking every time. */
export type ToolPolicy = 'ask' | 'allow'

/** How a tool's definition compares to the one that was approved. */
export type ToolStanding =
  /** Never seen before, so never approved. */
  | 'new'
  /** Approved once, but its definition has changed since. */
  | 'changed'
  /** Matches what was approved. */
  | 'known'

/** A tool as the Tools settings panel shows it. */
export type ToolInfo = {
  source: string
  /** Human-readable origin, for consent copy that names where a tool came from. */
  sourceLabel: string
  definition: ToolDefinition
  enabled: boolean
  policy: ToolPolicy
  standing: ToolStanding
}

/**
 * Identity of a tool across every source.
 *
 * Tool names are unique only within one server, so two servers may each export
 * `search`. Everything that records a decision about a tool keys on this.
 */
export function toolKey(source: string, name: string): string {
  return `${source}:${name}`
}
