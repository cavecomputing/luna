/**
 * Where a configured MCP server is written down.
 *
 * The same shape as `providers.ts`: pure functions over a database handle, with
 * thin wrappers at the bottom for the common case. Every row is parsed on the
 * way out — a row is `unknown` until it has been checked, exactly like an IPC
 * payload — and a row that fails to parse is dropped rather than guessed at.
 *
 * Nothing secret lives here. `env_names` records which variables a server takes;
 * their values are in platform secure storage, written and read only in main.
 */

import type { DatabaseSync } from 'node:sqlite'
import {
  MAX_ARGUMENT,
  MAX_ARGUMENTS,
  MAX_COMMAND,
  MAX_ENV_NAMES,
  MAX_SERVER_NAME,
  isEnvName,
  mcpSource,
  type McpEra,
  type McpServerDraft,
} from '../../shared/mcp.js'
import * as db from '../db.js'
import { array, object, text } from '../parse.js'

export type McpServerConfig = McpServerDraft & {
  id: string
  enabled: boolean
  era: McpEra | null
}

function era(value: unknown): McpEra | null | undefined {
  if (value === null || value === 'modern' || value === 'legacy') return value
  return undefined
}

/**
 * Reads a JSON column back into a list of bounded strings.
 *
 * All-or-nothing, via `array`: half an argument list would launch a server with
 * a command line nobody wrote.
 */
function strings(value: unknown, max: number, limit: number): string[] | undefined {
  if (typeof value !== 'string') return undefined
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    return undefined
  }
  const parsed = array(decoded, (item) => text(item, max))
  return parsed === undefined || parsed.length > limit ? undefined : parsed
}

function serverRow(row: unknown): McpServerConfig | undefined {
  const cell = object(row)
  if (cell === undefined) return undefined

  const name = text(cell.name, MAX_SERVER_NAME)
  const command = text(cell.command, MAX_COMMAND)
  const args = strings(cell.args, MAX_ARGUMENT, MAX_ARGUMENTS)
  const envNames = strings(cell.env_names, MAX_SERVER_NAME, MAX_ENV_NAMES)
  const cached = era(cell.era)

  if (
    typeof cell.id !== 'string' ||
    name === undefined ||
    name === '' ||
    command === undefined ||
    command === '' ||
    args === undefined ||
    envNames === undefined ||
    !envNames.every(isEnvName) ||
    (cell.cwd !== null && typeof cell.cwd !== 'string') ||
    (cell.enabled !== 0 && cell.enabled !== 1) ||
    cached === undefined
  ) {
    return undefined
  }

  return {
    id: cell.id,
    name,
    command,
    args,
    cwd: cell.cwd,
    envNames,
    enabled: cell.enabled === 1,
    era: cached,
  }
}

const COLUMNS = 'id, name, command, args, cwd, env_names, enabled, era'

export function list(conn: DatabaseSync): McpServerConfig[] {
  const rows = conn
    .prepare(`SELECT ${COLUMNS} FROM mcp_servers ORDER BY name COLLATE NOCASE, id`)
    .all()
  return rows.flatMap((row) => {
    const parsed = serverRow(row)
    return parsed === undefined ? [] : [parsed]
  })
}

export function find(conn: DatabaseSync, id: string): McpServerConfig | undefined {
  return serverRow(conn.prepare(`SELECT ${COLUMNS} FROM mcp_servers WHERE id = ?`).get(id))
}

export function create(
  conn: DatabaseSync,
  id: string,
  draft: McpServerDraft,
  now: number,
): McpServerConfig {
  conn
    .prepare(
      `INSERT INTO mcp_servers (id, name, command, args, cwd, env_names, enabled, era, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
    )
    .run(
      id,
      draft.name,
      draft.command,
      JSON.stringify(draft.args),
      draft.cwd,
      JSON.stringify(draft.envNames),
      now,
    )
  return { id, ...draft, enabled: false, era: null }
}

/**
 * Rewrites a server's definition.
 *
 * The cached era goes with it. How a server is launched decides which protocol
 * answers, so a remembered verdict about the old command line says nothing
 * about the new one.
 */
export function update(
  conn: DatabaseSync,
  id: string,
  draft: McpServerDraft,
): McpServerConfig | undefined {
  const result = conn
    .prepare(
      `UPDATE mcp_servers
       SET name = ?, command = ?, args = ?, cwd = ?, env_names = ?, era = NULL
       WHERE id = ?`,
    )
    .run(
      draft.name,
      draft.command,
      JSON.stringify(draft.args),
      draft.cwd,
      JSON.stringify(draft.envNames),
      id,
    )
  return result.changes === 0 ? undefined : find(conn, id)
}

/**
 * Forgets a server, and every decision anyone made about its tools.
 *
 * One transaction, because a grant outliving its server is a standing
 * permission with nothing visible behind it — and if the same id were ever
 * reused, a permission somebody granted to a different program.
 */
export function remove(conn: DatabaseSync, id: string): boolean {
  conn.exec('BEGIN')
  try {
    const removed = conn.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id).changes > 0
    conn.prepare('DELETE FROM tool_grants WHERE source = ?').run(mcpSource(id))
    conn.exec('COMMIT')
    return removed
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
}

export function setEnabled(
  conn: DatabaseSync,
  id: string,
  enabled: boolean,
): McpServerConfig | undefined {
  const result = conn
    .prepare('UPDATE mcp_servers SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, id)
  return result.changes === 0 ? undefined : find(conn, id)
}

/** Stores, or clears, what the last handshake with this server concluded. */
export function rememberEra(conn: DatabaseSync, id: string, value: McpEra | null): void {
  conn.prepare('UPDATE mcp_servers SET era = ? WHERE id = ?').run(value, id)
}

export function load(): McpServerConfig[] {
  return list(db.handle())
}

export function get(id: string): McpServerConfig | undefined {
  return find(db.handle(), id)
}

export function add(id: string, draft: McpServerDraft, now: number): McpServerConfig {
  return create(db.handle(), id, draft, now)
}

export function save(id: string, draft: McpServerDraft): McpServerConfig | undefined {
  return update(db.handle(), id, draft)
}

export function drop(id: string): boolean {
  return remove(db.handle(), id)
}

export function enable(id: string, enabled: boolean): McpServerConfig | undefined {
  return setEnabled(db.handle(), id, enabled)
}

export function recordEra(id: string, value: McpEra | null): void {
  rememberEra(db.handle(), id, value)
}
