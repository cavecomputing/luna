/**
 * Reading and changing what tools may do.
 *
 * The renderer can turn a tool on and off and revoke standing permission, and
 * it can *ask* for standing permission. It can never create one: both the
 * pre-approval toggle and the execution-time prompt are answered in main
 * against a native dialog, because the renderer is untrusted. See
 * tool-consent.ts.
 */

import { err, ok, type Result } from '../../shared/result.js'
import { toolKey, type ToolInfo, type ToolPolicy } from '../../shared/tools.js'
import * as db from '../db.js'
import { id, object, toolName } from '../parse.js'
import * as grants from '../tool-grants.js'
import type { Grant } from '../tool-grants.js'
import { builtinSource, Registry } from '../tools/registry.js'
import { sourcesFor } from '../mcp/sources.js'
import type { ToolDefinition } from '../../shared/tools.js'
import { confirmStanding } from '../tool-consent.js'
import { broadcast, handle } from './bus.js'

type Deps = {
  catalog: (signal: AbortSignal) => Promise<{ source: string; definition: ToolDefinition }[]>
  labelOf: (source: string) => string
  loadGrants: () => Map<string, Grant>
  reconcile: (source: string, definitions: readonly ToolDefinition[], now: number) => void
  setEnabled: (source: string, name: string, enabled: boolean, now: number) => Grant | undefined
  setPolicy: (source: string, name: string, value: ToolPolicy, now: number) => Grant | undefined
  /** Native, main-owned confirmation for a pre-approved standing grant. */
  confirmStanding: (request: { sourceLabel: string; definition: ToolDefinition }) => Promise<boolean>
  now: () => number
  notifyTools: (value: ToolInfo[]) => void
}

/**
 * Luna's own server plus whatever the user has switched on, resolved fresh each
 * time the registry asks. A server added, edited or disabled in Settings is in
 * or out of this list on the very next question — there is no second copy to
 * keep in step.
 */
export const registry = new Registry(() => [builtinSource(), ...sourcesFor()])

const deps: Deps = {
  catalog: (signal) => registry.catalog(signal),
  labelOf: (source) => registry.labelOf(source),
  loadGrants: () => grants.load(db.handle()),
  reconcile: (source, definitions, now) => {
    grants.reconcile(db.handle(), source, definitions, now)
  },
  setEnabled: (source, name, enabled, now) =>
    grants.setEnabled(db.handle(), source, name, enabled, now),
  setPolicy: (source, name, value, now) => grants.setPolicy(db.handle(), source, name, value, now),
  confirmStanding: (request) => confirmStanding(request),
  now: Date.now,
  notifyTools: (value) => {
    broadcast('tools:changed', value)
  },
}

/**
 * Discovers every source, records what was found, and describes the result.
 *
 * Discovery and reconciliation happen together on purpose: a tool that has just
 * been seen for the first time must have its disabled row written before anyone
 * can be told it exists, or the UI would offer a toggle with nothing behind it.
 */
async function survey(d: Deps, signal: AbortSignal): Promise<ToolInfo[]> {
  const found = await d.catalog(signal)
  const now = d.now()

  const bySource = new Map<string, ToolDefinition[]>()
  for (const entry of found) {
    const list = bySource.get(entry.source) ?? []
    list.push(entry.definition)
    bySource.set(entry.source, list)
  }
  for (const [source, definitions] of bySource) d.reconcile(source, definitions, now)

  const stored = d.loadGrants()
  return found.map((entry) => {
    const grant = stored.get(toolKey(entry.source, entry.definition.name))
    return {
      source: entry.source,
      sourceLabel: d.labelOf(entry.source),
      definition: entry.definition,
      // No row, or a row nobody approved, means the tool cannot run.
      enabled: grant?.enabled === true,
      policy: grant?.policy ?? 'ask',
      standing: grants.standing(grant, entry.definition),
    }
  })
}

export async function listTools(d: Deps = deps): Promise<Result<ToolInfo[]>> {
  return ok(await survey(d, new AbortController().signal))
}

function target(input: unknown): { source: string; name: string } | undefined {
  const req = object(input)
  const source = id(req?.source)
  const name = toolName(req?.name)
  return source === undefined || name === undefined ? undefined : { source, name }
}

export async function setEnabled(input: unknown, d: Deps = deps): Promise<Result<ToolInfo[]>> {
  const req = object(input)
  const found = target(input)
  if (found === undefined || typeof req?.enabled !== 'boolean') {
    return err('tool/invalid', 'tool selection was invalid')
  }
  // A tool that was never discovered has no row, so there is nothing to grant.
  if (d.setEnabled(found.source, found.name, req.enabled, d.now()) === undefined) {
    return err('tool/missing', 'tool was not found')
  }
  const value = await survey(d, new AbortController().signal)
  d.notifyTools(value)
  return ok(value)
}

/**
 * Grants standing permission, after a native prompt.
 *
 * The renderer asks; it never writes the grant. Declining is a success with the
 * list unchanged — the user did what they meant to, the same way cancelling the
 * privacy delete does.
 */
export async function allowAlways(input: unknown, d: Deps = deps): Promise<Result<ToolInfo[]>> {
  const found = target(input)
  if (found === undefined) return err('tool/invalid', 'tool selection was invalid')

  const current = await survey(d, new AbortController().signal)
  const entry = current.find(
    (tool) => tool.source === found.source && tool.definition.name === found.name,
  )
  if (entry === undefined) return err('tool/missing', 'tool was not found')
  // Standing permission on a switched-off tool is a grant nobody can see the
  // effect of, so it is refused rather than quietly stored.
  if (!entry.enabled) return err('tool/not-enabled', 'tool must be enabled first')
  if (entry.policy === 'allow') return ok(current)

  if (!(await d.confirmStanding({ sourceLabel: entry.sourceLabel, definition: entry.definition }))) {
    return ok(current)
  }
  if (d.setPolicy(found.source, found.name, 'allow', d.now()) === undefined) {
    return err('tool/missing', 'tool was not found')
  }
  const value = await survey(d, new AbortController().signal)
  d.notifyTools(value)
  return ok(value)
}

export async function requireApproval(
  input: unknown,
  d: Deps = deps,
): Promise<Result<ToolInfo[]>> {
  const found = target(input)
  if (found === undefined) return err('tool/invalid', 'tool selection was invalid')
  if (d.setPolicy(found.source, found.name, 'ask', d.now()) === undefined) {
    return err('tool/missing', 'tool was not found')
  }
  const value = await survey(d, new AbortController().signal)
  d.notifyTools(value)
  return ok(value)
}

export function register(): void {
  handle('tools:list', () => listTools())
  handle('tools:set-enabled', (_event, req) => setEnabled(req))
  handle('tools:allow-always', (_event, req) => allowAlways(req))
  handle('tools:require-approval', (_event, req) => requireApproval(req))
}
