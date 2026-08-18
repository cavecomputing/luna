/**
 * What tools exist, and how one gets called.
 *
 * A source is anywhere tools come from. Today there is exactly one, Luna's own
 * built-in server; an MCP server is the same shape reached over a different
 * transport, which is why nothing here assumes the connection is local.
 *
 * The registry deliberately does not decide whether a call is allowed. That is
 * the consent layer's job, and keeping the two apart means a dispatch path can
 * never accidentally become an approval path.
 */

import { err, ok, type Result } from '../../shared/result.js'
import { TOOL_CALL_TIMEOUT_MS, type ToolDefinition } from '../../shared/tools.js'
import type { McpEra } from '../../shared/mcp.js'
import { clientFor, handshake, type Client, type ClientInfo } from '../mcp/client.js'
import { connect, type Connection } from '../rpc/connect.js'
import { loopback } from '../rpc/loopback.js'
import type { Transport } from '../rpc/transport.js'
import { BUILTIN_LABEL, BUILTIN_SOURCE, builtinResponder } from './builtin.js'
import { failure, readResult, type CallIdentity, type ToolOutcome } from './result.js'

export type Source = {
  id: string
  label: string
  /** Built fresh each time the source is started, never shared between starts. */
  open: () => Transport
  /**
   * A previously determined era for this same configuration, if one is stored.
   * A shortcut past the probe, never a commitment — see `handshake`.
   */
  era?: McpEra
}

/** Self-reported to every server. Unverified by the protocol, and display-only. */
export const CLIENT_INFO: ClientInfo = { name: 'Luna', version: '1' }

export type ToolCall = {
  callId: string
  name: string
  /** Argument JSON as the model produced it. Parsed here, not by the stream. */
  arguments: string
}

/** The one source that ships today. */
export function builtinSource(): Source {
  return {
    id: BUILTIN_SOURCE,
    label: BUILTIN_LABEL,
    open: () => loopback(builtinResponder()),
  }
}

/** One live connection to a source, plus what it said it offers. */
type Live = {
  connection: Connection
  client: Client
  tools: ToolDefinition[]
}

export class Registry {
  private readonly live = new Map<string, Live>()

  constructor(private readonly sources: readonly Source[]) {}

  labelOf(source: string): string {
    return this.sources.find((entry) => entry.id === source)?.label ?? source
  }

  /**
   * Connects to a source if it is not already connected, and returns what it
   * offers. Connections are lazy: nothing is started until a tool is wanted.
   */
  async discover(sourceId: string, signal: AbortSignal): Promise<Result<ToolDefinition[]>> {
    const existing = this.live.get(sourceId)
    if (existing !== undefined) return ok(existing.tools)

    const source = this.sources.find((entry) => entry.id === sourceId)
    if (source === undefined) return err('tool/no-source', 'unknown tool source')

    const connection = connect(source.open(), { timeoutMs: TOOL_CALL_TIMEOUT_MS })
    const started = await connection.start(signal)
    if (!started.ok) return started

    const agreed = await handshake(connection.peer, CLIENT_INFO, signal, {
      ...(source.era === undefined ? {} : { cached: source.era }),
    })
    if (!agreed.ok) {
      await connection.stop(0)
      return agreed
    }

    const client = clientFor(connection.peer, agreed.value, CLIENT_INFO)
    const listed = await client.listTools(signal)
    if (!listed.ok) {
      await connection.stop(0)
      return listed
    }

    this.live.set(sourceId, { connection, client, tools: listed.value })
    return ok(listed.value)
  }

  /** Everything every source offers, paired with where it came from. */
  async catalog(signal: AbortSignal): Promise<{ source: string; definition: ToolDefinition }[]> {
    const out: { source: string; definition: ToolDefinition }[] = []
    for (const source of this.sources) {
      const found = await this.discover(source.id, signal)
      if (!found.ok) continue
      for (const definition of found.value) out.push({ source: source.id, definition })
    }
    return out
  }

  /**
   * Runs one call and reports what happened.
   *
   * Never rejects. Every failure the model could plausibly work around — bad
   * argument JSON, an unknown tool, a dead source — comes back as a tool error
   * it can read and retry against. Only the caller decides that a turn is over.
   */
  async call(sourceId: string, call: ToolCall, signal: AbortSignal): Promise<ToolOutcome> {
    const identity: CallIdentity = {
      callId: call.callId,
      source: sourceId,
      name: call.name,
      arguments: call.arguments,
    }

    let args: Record<string, unknown>
    try {
      const parsed: unknown = call.arguments.trim() === '' ? {} : JSON.parse(call.arguments)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return failure(identity, 'The arguments must be a single JSON object.')
      }
      args = { ...parsed }
    } catch {
      // The model wrote malformed JSON. That is its mistake to fix, not a
      // reason to end the turn.
      return failure(identity, 'The arguments were not valid JSON. Send a single JSON object.')
    }

    const live = this.live.get(sourceId)
    if (live === undefined) return failure(identity, 'That tool is not available right now.')
    if (!live.tools.some((tool) => tool.name === call.name)) {
      const available = live.tools.map((tool) => tool.name).join(', ')
      return failure(identity, `No tool named ${call.name}. Available: ${available || 'none'}.`)
    }

    const replied = await live.client.callTool(call.name, args, signal)
    if (!replied.ok) {
      return failure(identity, `The tool did not complete (${replied.code}).`)
    }
    return readResult(identity, replied.value)
  }

  /** Shuts every connection down. Called when the app is quitting. */
  async stopAll(): Promise<void> {
    const open = [...this.live.values()]
    this.live.clear()
    await Promise.allSettled(open.map((entry) => entry.connection.stop(1_000)))
  }
}

export const toolSources: readonly Source[] = [builtinSource()]
