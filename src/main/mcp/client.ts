/**
 * Speaking MCP to a server, across two incompatible eras of the protocol.
 *
 * Revision `2026-07-28` removed the `initialize` handshake. A modern server is
 * stateless: every request carries its own protocol version and client
 * capabilities in `params._meta`, and nothing is negotiated up front. A legacy
 * server (`2025-11-25` and earlier) expects `initialize` first and rejects
 * anything that arrives before it.
 *
 * Luna has to speak both. The modern revision is new and almost every server
 * installed today is legacy, so supporting only the modern era would ship a
 * feature with nothing to connect to.
 *
 * The specified way to tell them apart on stdio is to probe with
 * `server/discover`, which servers MUST implement, and read the answer:
 *
 * - a result, or a recognized modern error, means modern — and a
 *   `-32022` names the versions it will accept, so we retry rather than
 *   falling back;
 * - anything else, **including silence**, means legacy.
 *
 * That last clause is why the probe carries its own short deadline instead of
 * the peer's ordinary one. A legacy server may simply never answer a method it
 * has no case for, and thirty seconds of nothing at startup is indistinguishable
 * from a hang. The fallback also deliberately does not key on a particular error
 * code: legacy servers answer an unknown pre-`initialize` method with whatever
 * their implementation happens to return.
 *
 * This file owns no process and no stream. It is handed a peer.
 */

import type { McpEra } from '../../shared/mcp.js'
import { err, ok, type Result } from '../../shared/result.js'
import type { ToolDefinition } from '../../shared/tools.js'
import { object, text, toolName } from '../parse.js'
import type { JsonRpcPeer } from '../rpc/jsonrpc.js'

/** The stateless revision, and the only modern one Luna speaks. */
export const MODERN_VERSION = '2026-07-28'

/** The newest handshake-based revision, used when falling back. */
export const LEGACY_VERSION = '2025-11-25'

/** Modern versions we accept, best first. */
export const SUPPORTED: readonly string[] = [MODERN_VERSION]

/** `UnsupportedProtocolVersionError`. The one modern error code that matters here. */
const UNSUPPORTED_VERSION = -32022

/**
 * How long a probe waits before concluding the server is legacy.
 *
 * Short on purpose. This is startup latency for every legacy server the user
 * has configured, and the answer either comes back promptly or is not coming.
 */
export const PROBE_TIMEOUT_MS = 5_000

/** A server paginating `tools/list` forever is a server-controlled loop. */
export const MAX_TOOL_PAGES = 20

export type ClientInfo = { name: string; version: string }

export type Handshake = {
  era: McpEra
  version: string
  /** Self-reported and unverified. For display only; nothing branches on it. */
  serverName?: string
}

function meta(version: string, info: ClientInfo): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientInfo': info,
    // Required on every request, and empty is the truth: Luna implements no
    // client-side features. A server asking for one gets a -32021 back, which
    // is exactly the conversation that should happen.
    'io.modelcontextprotocol/clientCapabilities': {},
  }
}

/**
 * Adds the per-request protocol fields a modern server requires.
 *
 * One place, so a new method cannot forget a required field and get a -32602
 * that looks like a bad argument.
 */
export function withMeta(
  params: Record<string, unknown>,
  version: string,
  info: ClientInfo,
): Record<string, unknown> {
  return { ...params, _meta: meta(version, info) }
}

function serverName(value: unknown): string | undefined {
  const info = object(object(object(value)?._meta)?.['io.modelcontextprotocol/serverInfo'])
  return text(info?.name, 128)
}

/** The best version both sides accept, in our order of preference. */
function mutual(offered: unknown): string | undefined {
  if (!Array.isArray(offered)) return undefined
  return SUPPORTED.find((version) => offered.includes(version))
}

export type HandshakeOptions = {
  /**
   * A previous verdict for this same server configuration, which the
   * specification allows persisting. A shortcut, never a commitment: a cached
   * answer that turns out to be wrong falls through to a full probe.
   */
  cached?: McpEra
  /** Injected so a test can prove the silence branch without waiting for it. */
  probeMs?: number
}

/** Works out which era a server belongs to, and settles on a version. */
export async function handshake(
  peer: JsonRpcPeer,
  info: ClientInfo,
  signal: AbortSignal,
  options: HandshakeOptions = {},
): Promise<Result<Handshake>> {
  if (options.cached === 'legacy') {
    const shortcut = await initialize(peer, info, signal)
    if (shortcut.ok) return shortcut
    if (signal.aborted) return shortcut
  }

  const probe = await peer.call(
    'server/discover',
    withMeta({}, MODERN_VERSION, info),
    AbortSignal.any([signal, AbortSignal.timeout(options.probeMs ?? PROBE_TIMEOUT_MS)]),
  )

  switch (probe.kind) {
    case 'ok': {
      const version = mutual(object(probe.value)?.supportedVersions)
      if (version === undefined) {
        return err('mcp/no-version', 'server supports no protocol version Luna speaks')
      }
      const named = serverName(probe.value)
      return ok({ era: 'modern', version, ...(named === undefined ? {} : { serverName: named }) })
    }

    case 'error': {
      // A modern refusal, which names what it would accept. The server is
      // modern either way, so this never falls back to initialize.
      if (probe.code === UNSUPPORTED_VERSION) {
        const version = mutual(object(probe.data)?.supported)
        if (version === undefined) {
          return err('mcp/no-version', 'server supports no protocol version Luna speaks')
        }
        return ok({ era: 'modern', version })
      }
      return initialize(peer, info, signal)
    }

    // Silence is the specified legacy signal, and our own deadline is how we
    // hear it. A cancel from the caller is not: that is the user leaving.
    case 'cancelled':
    case 'timeout':
      return signal.aborted
        ? err('mcp/cancelled', 'cancelled')
        : initialize(peer, info, signal)

    case 'closed':
      return err('mcp/closed', 'server closed the connection')
    case 'write':
      return err('mcp/closed', 'server could not be written to')
  }
}

/**
 * The legacy opening exchange.
 *
 * The server answers with the version it actually chose, which need not be the
 * one asked for, and the notification afterwards is what unblocks it.
 */
async function initialize(
  peer: JsonRpcPeer,
  info: ClientInfo,
  signal: AbortSignal,
): Promise<Result<Handshake>> {
  const replied = await peer.request(
    'initialize',
    { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: info },
    signal,
  )
  if (!replied.ok) return err('mcp/handshake', 'server did not complete a handshake')

  const cell = object(replied.value)
  if (cell === undefined) return err('mcp/handshake', 'server did not complete a handshake')

  peer.notify('notifications/initialized')
  const named = text(object(cell.serverInfo)?.name, 128)
  return ok({
    era: 'legacy',
    version: text(cell.protocolVersion, 64) ?? LEGACY_VERSION,
    ...(named === undefined ? {} : { serverName: named }),
  })
}

/**
 * Reads one page of a tools/list reply.
 *
 * Every field comes from outside, so a tool that fails to parse is dropped
 * rather than trusted. Dropping one tool is safe in a way that dropping half a
 * call/result pair is not: the model simply never sees it.
 */
export function readTools(value: unknown): ToolDefinition[] {
  const cell = object(value)
  if (!Array.isArray(cell?.tools)) return []
  const parsed: ToolDefinition[] = []
  for (const entry of cell.tools) {
    const item = object(entry)
    const name = toolName(item?.name)
    // A schema is required and must be an object; a tool without one cannot be
    // described to a provider at all.
    const schema = Array.isArray(item?.inputSchema) ? undefined : object(item?.inputSchema)
    if (item === undefined || name === undefined || schema === undefined) continue
    const description = text(item.description, 8192) ?? ''
    const title = text(item.title, 256)
    const annotations = object(item.annotations)
    const outputSchema = Array.isArray(item.outputSchema) ? undefined : object(item.outputSchema)
    parsed.push({
      name,
      ...(title === undefined || title === '' ? {} : { title }),
      description,
      inputSchema: schema,
      ...(outputSchema === undefined ? {} : { outputSchema }),
      ...(annotations === undefined
        ? {}
        : {
            annotations: {
              ...(typeof annotations.readOnlyHint === 'boolean'
                ? { readOnlyHint: annotations.readOnlyHint }
                : {}),
              ...(typeof annotations.destructiveHint === 'boolean'
                ? { destructiveHint: annotations.destructiveHint }
                : {}),
              ...(typeof annotations.idempotentHint === 'boolean'
                ? { idempotentHint: annotations.idempotentHint }
                : {}),
              ...(typeof annotations.openWorldHint === 'boolean'
                ? { openWorldHint: annotations.openWorldHint }
                : {}),
            },
          }),
    })
  }
  return parsed
}

/**
 * A connected server, addressed in whichever era it turned out to speak.
 *
 * Notably absent: `instructions`. Both handshakes offer natural-language
 * guidance for the model, written by a process Luna did not author and cannot
 * verify. Putting that in a system prompt is the injection route the whole
 * consent model exists to close, so it is read past and discarded. Do not
 * "fix" this later without deciding, on purpose, how to fence it.
 */
export type Client = {
  handshake: Handshake
  listTools: (signal: AbortSignal) => Promise<Result<ToolDefinition[]>>
  callTool: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<Result<unknown>>
}

export function clientFor(peer: JsonRpcPeer, agreed: Handshake, info: ClientInfo): Client {
  const frame = (params: Record<string, unknown>): Record<string, unknown> =>
    agreed.era === 'modern' ? withMeta(params, agreed.version, info) : params

  return {
    handshake: agreed,

    listTools: async (signal: AbortSignal): Promise<Result<ToolDefinition[]>> => {
      const found: ToolDefinition[] = []
      let cursor: string | undefined

      for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
        const replied = await peer.request(
          'tools/list',
          frame(cursor === undefined ? {} : { cursor }),
          signal,
        )
        if (!replied.ok) return replied

        found.push(...readTools(replied.value))
        const next = text(object(replied.value)?.nextCursor, 4096)
        // A cursor that repeats would page forever; the cap below is what
        // actually stops it, but an unchanged cursor is already a broken server.
        if (next === undefined || next === '' || next === cursor) return ok(found)
        cursor = next
      }
      // Everything gathered so far is still usable, and refusing it would make
      // an over-eager server look like a dead one.
      return ok(found)
    },

    callTool: (name, args, signal) =>
      peer.request('tools/call', frame({ name, arguments: args }), signal),
  }
}
