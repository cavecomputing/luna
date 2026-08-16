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
import { object, text, toolName } from '../parse.js'
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
}

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

/**
 * Reads a tools/list reply.
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
    const schema = object(item?.inputSchema)
    if (item === undefined || name === undefined || schema === undefined) continue
    const description = text(item.description, 8192) ?? ''
    const title = text(item.title, 256)
    const annotations = object(item.annotations)
    parsed.push({
      name,
      ...(title === undefined || title === '' ? {} : { title }),
      description,
      inputSchema: schema,
      ...(object(item.outputSchema) === undefined ? {} : { outputSchema: item.outputSchema }),
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

/** One live connection to a source, plus what it said it offers. */
type Live = {
  connection: Connection
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

    const listed = await connection.peer.request('tools/list', {}, signal)
    if (!listed.ok) {
      await connection.stop(0)
      return listed
    }

    const tools = readTools(listed.value)
    this.live.set(sourceId, { connection, tools })
    return ok(tools)
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

    let args: unknown
    try {
      args = call.arguments.trim() === '' ? {} : JSON.parse(call.arguments)
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

    const replied = await live.connection.peer.request(
      'tools/call',
      { name: call.name, arguments: args },
      signal,
    )
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
