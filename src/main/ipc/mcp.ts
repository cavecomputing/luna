/**
 * Adding, editing and running the user's MCP servers.
 *
 * A server is an arbitrary program. Everything here follows from that:
 *
 * - **A new server is created switched off.** Writing a row commits Luna to
 *   nothing; starting the program is a separate step with its own answer.
 * - **Only a native prompt owned by main turns one on.** `mcp:set-enabled`
 *   arrives over the same channel a compromised page can send anything on, so
 *   the renderer asks and a person answers. Declining is a success with the
 *   server still off, exactly like declining a standing tool grant.
 * - **Credentials go one way.** Values travel renderer to main once and are
 *   written to platform secure storage. Nothing here ever sends one back; the
 *   renderer learns only whether something is stored, which is the same deal
 *   provider keys get.
 *
 * Changing a server drops its live connection, because the row and the running
 * process are two different things and the registry cannot tell them apart.
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import {
  MAX_ARGUMENT,
  MAX_ARGUMENTS,
  MAX_COMMAND,
  MAX_ENV_NAMES,
  MAX_ENV_VALUE,
  MAX_SERVER_NAME,
  isEnvName,
  mcpSource,
  type McpServerDraft,
  type McpServerInfo,
} from '../../shared/mcp.js'
import { err, ok, type Result } from '../../shared/result.js'
import { array, id, object, text } from '../parse.js'
import * as secrets from '../secrets.js'
import { confirmServer } from '../tool-consent.js'
import type { SourceState } from '../tools/registry.js'
import { broadcast, handle } from './bus.js'
import type { McpServerConfig } from '../mcp/servers.js'
import * as servers from '../mcp/servers.js'
import { registry, refresh } from './tools.js'

type Deps = {
  list: () => McpServerConfig[]
  get: (id: string) => McpServerConfig | undefined
  add: (id: string, draft: McpServerDraft, now: number) => McpServerConfig
  save: (id: string, draft: McpServerDraft) => McpServerConfig | undefined
  drop: (id: string) => boolean
  enable: (id: string, enabled: boolean) => McpServerConfig | undefined
  hasEnv: (id: string) => Promise<boolean>
  writeEnv: (id: string, values: Record<string, string>) => Promise<void>
  clearEnv: (id: string) => Promise<void>
  /** Native, main-owned confirmation before a program is allowed to run. */
  confirmServer: (request: {
    name: string
    command: string
    args: readonly string[]
    envNames: readonly string[]
  }) => Promise<boolean>
  states: () => Map<string, SourceState>
  /** Ends a live connection so the next start reads the current configuration. */
  forget: (source: string) => Promise<void>
  /** Re-discovers every source and tells every window what tools exist now. */
  refresh: () => Promise<unknown>
  newId: () => string
  now: () => number
  notify: (value: McpServerInfo[]) => void
}

const deps: Deps = {
  list: servers.load,
  get: servers.get,
  add: servers.add,
  save: servers.save,
  drop: servers.drop,
  enable: servers.enable,
  hasEnv: secrets.hasEnv,
  writeEnv: secrets.writeEnv,
  clearEnv: secrets.clearEnv,
  confirmServer: (request) => confirmServer(request),
  states: () => registry.states(),
  forget: (source) => registry.forget(source),
  refresh: () => refresh(),
  newId: randomUUID,
  now: Date.now,
  notify: (value) => {
    broadcast('mcp:changed', value)
  },
}

/**
 * One command-line word.
 *
 * Control characters are refused because nothing legitimate contains one and a
 * newline in an argument is how a value smuggles a second line into whatever
 * reads it back — a log, a dialog, a shell history. Unlike `text`, this does not
 * trim: an argument is passed through verbatim and Luna does not get to decide
 * that a trailing space was a mistake.
 */
function word(input: unknown, max: number): string | undefined {
  if (typeof input !== 'string' || input.length > max) return undefined
  // eslint-disable-next-line no-control-regex -- refusing them is the point
  return /[\u0000-\u001f\u007f]/.test(input) ? undefined : input
}

/**
 * Where the server runs.
 *
 * Absolute or nothing. A relative path would resolve against Luna's own working
 * directory, which is wherever the app happened to be launched from — the same
 * configuration would then mean a different directory on every launch.
 */
function workingDirectory(input: unknown): string | null | undefined {
  if (input === null || input === '') return null
  const path = word(input, MAX_COMMAND)
  if (path === undefined || !isAbsolute(path)) return undefined
  return path
}

export function cleanDraft(input: unknown): Result<McpServerDraft> {
  const value = object(input)
  if (value === undefined) return err('mcp/invalid', 'server was not an object')

  const name = text(value.name, MAX_SERVER_NAME)
  const command = word(value.command, MAX_COMMAND)?.trim()
  const args = array(value.args, (item) => word(item, MAX_ARGUMENT))
  const cwd = workingDirectory(value.cwd)
  const envNames = array(value.envNames, (item) =>
    typeof item === 'string' && isEnvName(item) ? item : undefined,
  )

  if (
    name === undefined ||
    name === '' ||
    command === undefined ||
    command === '' ||
    args === undefined ||
    args.length > MAX_ARGUMENTS ||
    cwd === undefined ||
    envNames === undefined ||
    envNames.length > MAX_ENV_NAMES ||
    new Set(envNames).size !== envNames.length
  ) {
    return err('mcp/invalid', 'server configuration was invalid')
  }

  return ok({ name, command, args, cwd, envNames })
}

/**
 * A stored row plus what the registry currently thinks of it.
 *
 * The row's remembered era is deliberately not reported: it is a shortcut past
 * the probe, not a fact about a running server. What the panel shows is what the
 * last handshake actually concluded, and nothing while nothing is running.
 */
async function decorate(config: McpServerConfig, d: Deps): Promise<McpServerInfo> {
  const state = d.states().get(mcpSource(config.id))
  return {
    id: config.id,
    name: config.name,
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    envNames: config.envNames,
    enabled: config.enabled,
    hasEnv: await d.hasEnv(config.id),
    status: state?.status ?? 'idle',
    toolCount: state?.toolCount ?? 0,
    ...(state?.errorCode === undefined ? {} : { errorCode: state.errorCode }),
    ...(state?.era === undefined ? {} : { era: state.era }),
    ...(state?.version === undefined ? {} : { version: state.version }),
    ...(state?.serverName === undefined ? {} : { serverName: state.serverName }),
  }
}

async function all(d: Deps): Promise<McpServerInfo[]> {
  return await Promise.all(d.list().map((config) => decorate(config, d)))
}

async function announce(d: Deps): Promise<McpServerInfo[]> {
  const value = await all(d)
  d.notify(value)
  return value
}

/**
 * Re-reads a server after its live connection was dropped and rebuilt.
 *
 * Both broadcasts fire: the set of tools changed, and so did what the Servers
 * panel has to say about the server that produced them.
 */
async function settle(serverId: string, d: Deps): Promise<Result<McpServerInfo>> {
  await d.forget(mcpSource(serverId))
  await d.refresh()
  const current = d.get(serverId)
  if (current === undefined) return err('mcp/missing', 'server was not found')
  const value = await decorate(current, d)
  await announce(d)
  return ok(value)
}

export async function listServers(d: Deps = deps): Promise<Result<McpServerInfo[]>> {
  return ok(await all(d))
}

export async function createServer(input: unknown, d: Deps = deps): Promise<Result<McpServerInfo>> {
  const parsed = cleanDraft(input)
  if (!parsed.ok) return parsed
  const created = d.add(d.newId(), parsed.value, d.now())
  const value = await decorate(created, d)
  await announce(d)
  return ok(value)
}

export async function updateServer(input: unknown, d: Deps = deps): Promise<Result<McpServerInfo>> {
  const req = object(input)
  const serverId = id(req?.id)
  const parsed = cleanDraft(req?.server)
  if (serverId === undefined || !parsed.ok) {
    return parsed.ok ? err('mcp/invalid', 'server id was invalid') : parsed
  }
  if (d.save(serverId, parsed.value) === undefined) {
    return err('mcp/missing', 'server was not found')
  }
  return settle(serverId, d)
}

export async function deleteServer(input: unknown, d: Deps = deps): Promise<Result<undefined>> {
  const req = object(input)
  const serverId = id(req?.id)
  if (serverId === undefined) return err('mcp/invalid', 'server id was invalid')
  if (d.get(serverId) === undefined) return err('mcp/missing', 'server was not found')

  // The process goes first. Removing the row while the program is still running
  // would leave something Luna started with nothing left that remembers it.
  await d.forget(mcpSource(serverId))
  try {
    await d.clearEnv(serverId)
  } catch {
    return err('secret/unavailable', 'stored credentials could not be removed')
  }
  d.drop(serverId)
  await d.refresh()
  await announce(d)
  return ok(undefined)
}

/**
 * Starts or stops running a server, after a native prompt for the start.
 *
 * Switching one off never asks. Stopping something is not a capability anyone
 * needs protecting from, and a confirmation there would train people to click
 * through the one that matters.
 */
export async function setServerEnabled(
  input: unknown,
  d: Deps = deps,
): Promise<Result<McpServerInfo>> {
  const req = object(input)
  const serverId = id(req?.id)
  if (serverId === undefined || typeof req?.enabled !== 'boolean') {
    return err('mcp/invalid', 'server selection was invalid')
  }
  const config = d.get(serverId)
  if (config === undefined) return err('mcp/missing', 'server was not found')
  if (config.enabled === req.enabled) return ok(await decorate(config, d))

  if (req.enabled) {
    const agreed = await d.confirmServer({
      name: config.name,
      command: config.command,
      args: config.args,
      envNames: config.envNames,
    })
    // Cancelling is the user doing what they meant to, so the call succeeds
    // with the server exactly as it was.
    if (!agreed) return ok(await decorate(config, d))
  }

  if (d.enable(serverId, req.enabled) === undefined) {
    return err('mcp/missing', 'server was not found')
  }
  return settle(serverId, d)
}

/**
 * Stores the variables a server is launched with, or clears them.
 *
 * Only names the server is configured to take are accepted. A value under a
 * name that is not on its list would sit in storage reaching nothing, and the
 * panel would have no place to show it.
 */
export async function setServerEnv(input: unknown, d: Deps = deps): Promise<Result<McpServerInfo>> {
  const req = object(input)
  const serverId = id(req?.id)
  if (serverId === undefined) return err('mcp/invalid', 'server selection was invalid')
  const config = d.get(serverId)
  if (config === undefined) return err('mcp/missing', 'server was not found')

  if (req?.values !== null) {
    const values = object(req?.values)
    if (values === undefined) return err('mcp/invalid', 'variables were invalid')
    const entries = Object.entries(values)
    if (entries.length > MAX_ENV_NAMES) return err('mcp/invalid', 'variables were invalid')

    const stored: Record<string, string> = {}
    for (const [name, value] of entries) {
      if (
        !isEnvName(name) ||
        !config.envNames.includes(name) ||
        typeof value !== 'string' ||
        value.length > MAX_ENV_VALUE
      ) {
        return err('mcp/invalid', 'variables were invalid')
      }
      stored[name] = value
    }
    try {
      await d.writeEnv(serverId, stored)
    } catch {
      return err('secret/unavailable', 'secure credential storage failed')
    }
  } else {
    try {
      await d.clearEnv(serverId)
    } catch {
      return err('secret/unavailable', 'secure credential removal failed')
    }
  }

  // A running server is holding the old values in its own environment, where
  // Luna cannot reach them. Only a restart makes the change true.
  return settle(serverId, d)
}

/** Drops a live connection and tries again now, past any cooldown. */
export async function restartServer(input: unknown, d: Deps = deps): Promise<Result<McpServerInfo>> {
  const req = object(input)
  const serverId = id(req?.id)
  if (serverId === undefined) return err('mcp/invalid', 'server selection was invalid')
  if (d.get(serverId) === undefined) return err('mcp/missing', 'server was not found')
  return settle(serverId, d)
}

export function register(): void {
  handle('mcp:list', () => listServers())
  handle('mcp:create', (_event, req) => createServer(req))
  handle('mcp:update', (_event, req) => updateServer(req))
  handle('mcp:delete', (_event, req) => deleteServer(req))
  handle('mcp:set-enabled', (_event, req) => setServerEnabled(req))
  handle('mcp:set-env', (_event, req) => setServerEnv(req))
  handle('mcp:restart', (_event, req) => restartServer(req))
}
