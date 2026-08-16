/**
 * Which tools are allowed to run.
 *
 * Two rules make the rest of this file follow:
 *
 * 1. A tool nobody has approved cannot execute. Absence of a row means no, and
 *    a new row is written disabled, so a server that quietly gains a tool
 *    gains no capability with it.
 * 2. Approval is of a *definition*, not of a name. The digest covers the
 *    description and the annotations as well as the schema, so a server that
 *    rewrites what a tool claims to do — the injection route that leaves the
 *    name untouched — has to ask again.
 *
 * Nothing stored here is a secret, so the database is the right home.
 */

import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { toolKey, type ToolDefinition, type ToolPolicy, type ToolStanding } from '../shared/tools.js'
import { object } from './parse.js'

export type Grant = {
  source: string
  toolName: string
  enabled: boolean
  policy: ToolPolicy
  digest: string
  seenAt: number
  approvedAt?: number
}

/**
 * Fingerprints everything a person would be agreeing to.
 *
 * Order is fixed rather than taken from key order, so an identical definition
 * always hashes the same. Annotations are included precisely because they are
 * untrusted: they shape the consent copy, so changing them must invalidate the
 * consent.
 */
export function digestOf(definition: ToolDefinition): string {
  const canonical = JSON.stringify([
    definition.name,
    definition.title ?? '',
    definition.description,
    stable(definition.inputSchema),
    stable(definition.outputSchema ?? null),
    [
      definition.annotations?.readOnlyHint ?? null,
      definition.annotations?.destructiveHint ?? null,
      definition.annotations?.idempotentHint ?? null,
      definition.annotations?.openWorldHint ?? null,
    ],
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

/** Key order in JSON is not meaningful, so sort it before hashing. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  const cell = object(value)
  if (cell === undefined) return value
  return Object.keys(cell)
    .sort()
    .map((key) => [key, stable(cell[key])])
}

function policy(input: unknown): ToolPolicy | undefined {
  return input === 'ask' || input === 'allow' ? input : undefined
}

function grantRow(row: unknown): Grant | undefined {
  const cell = object(row)
  if (cell === undefined) return undefined
  const parsedPolicy = policy(cell.policy)
  if (
    typeof cell.source !== 'string' ||
    typeof cell.tool_name !== 'string' ||
    (cell.enabled !== 0 && cell.enabled !== 1) ||
    parsedPolicy === undefined ||
    typeof cell.digest !== 'string' ||
    typeof cell.seen_at !== 'number'
  ) {
    return undefined
  }
  return {
    source: cell.source,
    toolName: cell.tool_name,
    enabled: cell.enabled === 1,
    policy: parsedPolicy,
    digest: cell.digest,
    seenAt: cell.seen_at,
    ...(typeof cell.approved_at === 'number' ? { approvedAt: cell.approved_at } : {}),
  }
}

export function load(conn: DatabaseSync): Map<string, Grant> {
  const out = new Map<string, Grant>()
  for (const row of conn
    .prepare('SELECT source, tool_name, enabled, policy, digest, seen_at, approved_at FROM tool_grants')
    .all()) {
    const parsed = grantRow(row)
    if (parsed !== undefined) out.set(toolKey(parsed.source, parsed.toolName), parsed)
  }
  return out
}

export function find(conn: DatabaseSync, source: string, name: string): Grant | undefined {
  return grantRow(
    conn
      .prepare(
        `SELECT source, tool_name, enabled, policy, digest, seen_at, approved_at
         FROM tool_grants WHERE source = ? AND tool_name = ?`,
      )
      .get(source, name),
  )
}

/**
 * Records what was just discovered, and revokes anything that changed.
 *
 * Called after every discovery pass. A tool that is new gets a disabled row; a
 * tool whose digest moved is forced back to disabled and 'ask' with its
 * approval timestamp cleared; a tool that matches is left alone so its grant
 * survives.
 */
export function reconcile(
  conn: DatabaseSync,
  source: string,
  definitions: readonly ToolDefinition[],
  now: number,
): void {
  conn.exec('BEGIN')
  try {
    for (const definition of definitions) {
      const digest = digestOf(definition)
      const existing = find(conn, source, definition.name)
      if (existing === undefined) {
        conn
          .prepare(
            `INSERT INTO tool_grants (source, tool_name, enabled, policy, digest, seen_at)
             VALUES (?, ?, 0, 'ask', ?, ?)`,
          )
          .run(source, definition.name, digest, now)
        continue
      }
      if (existing.digest === digest) {
        conn
          .prepare('UPDATE tool_grants SET seen_at = ? WHERE source = ? AND tool_name = ?')
          .run(now, source, definition.name)
        continue
      }
      conn
        .prepare(
          `UPDATE tool_grants
           SET enabled = 0, policy = 'ask', digest = ?, seen_at = ?, approved_at = NULL
           WHERE source = ? AND tool_name = ?`,
        )
        .run(digest, now, source, definition.name)
    }
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
}

/** How a definition compares to whatever was approved for that name. */
export function standing(grant: Grant | undefined, definition: ToolDefinition): ToolStanding {
  if (grant?.approvedAt === undefined) return 'new'
  return grant.digest === digestOf(definition) ? 'known' : 'changed'
}

export function setEnabled(
  conn: DatabaseSync,
  source: string,
  name: string,
  enabled: boolean,
  now: number,
): Grant | undefined {
  // Turning a tool off also drops any standing permission it had. Re-enabling
  // should not silently restore "never ask me again".
  conn
    .prepare(
      `UPDATE tool_grants
       SET enabled = ?, approved_at = ?, policy = CASE WHEN ? = 1 THEN policy ELSE 'ask' END
       WHERE source = ? AND tool_name = ?`,
    )
    .run(enabled ? 1 : 0, enabled ? now : null, enabled ? 1 : 0, source, name)
  return find(conn, source, name)
}

export function setPolicy(
  conn: DatabaseSync,
  source: string,
  name: string,
  value: ToolPolicy,
  now: number,
): Grant | undefined {
  conn
    .prepare(
      `UPDATE tool_grants SET policy = ?, approved_at = ? WHERE source = ? AND tool_name = ?`,
    )
    .run(value, now, source, name)
  return find(conn, source, name)
}
