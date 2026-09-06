/**
 * What an MCP server is, as far as every process is concerned.
 *
 * Configuration only. A server's credentials are not here and never cross this
 * boundary: the renderer sees which environment variables a server takes, never
 * what they are set to, the same way it sees that a provider has an API key
 * without ever seeing the key.
 */

/** Which era of the protocol a server turned out to speak. */
export type McpEra = 'modern' | 'legacy'

/** Bounds shared by the form that collects a server and the code that stores it. */
export const MAX_SERVER_NAME = 128
export const MAX_COMMAND = 1024
export const MAX_ARGUMENT = 4096
export const MAX_ARGUMENTS = 64
export const MAX_ENV_NAMES = 64
export const MAX_ENV_VALUE = 8192

/**
 * A portable environment variable name.
 *
 * Deliberately narrow. A name outside this shape is either a typo or an attempt
 * to smuggle something through a variable list, and no MCP server documents one.
 */
export function isEnvName(value: string): boolean {
  return value.length <= MAX_SERVER_NAME && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

/** Everything a user types to describe a server. */
export type McpServerDraft = {
  name: string
  command: string
  args: string[]
  /** Where to run it. Null means Luna does not choose, and the OS default wins. */
  cwd: string | null
  /** Variable names only. The values live in platform secure storage. */
  envNames: string[]
}

export type McpServer = McpServerDraft & {
  id: string
  enabled: boolean
  /** Whether a value is stored for every name above. Never the values. */
  hasEnv: boolean
}

/** Where a server is in its lifecycle, as the Settings panel shows it. */
export type McpStatus =
  /** Configured and switched off, or on but not needed yet. */
  | 'idle'
  /** Being launched, or mid-handshake. */
  | 'starting'
  /** Answered a handshake and listed its tools. */
  | 'ready'
  /** Could not be launched, or did not complete a handshake. */
  | 'failed'

export type McpServerInfo = McpServer & {
  status: McpStatus
  /** Stable code when `status` is 'failed'. The renderer switches on it. */
  errorCode?: string
  toolCount: number
  /** Reported once a handshake succeeds, for diagnostics. */
  era?: McpEra
  version?: string
  /** Self-reported by the server, unverified, and shown as its own claim. */
  serverName?: string
}

/**
 * How a server's tools are keyed in `tool_grants`.
 *
 * Prefixed so a server can never collide with `builtin`, or with a future
 * source that is not a server at all.
 */
export function mcpSource(id: string): string {
  return `mcp:${id}`
}
