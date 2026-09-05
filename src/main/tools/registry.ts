/**
 * What tools exist, and how one gets called.
 *
 * A source is anywhere tools come from: Luna's own built-in server over an
 * in-process loopback, or an MCP server the user configured, running as a
 * subprocess. Nothing here knows which is which — that is the whole point of
 * the transport seam.
 *
 * The set of sources changes while the app runs, so it arrives as a function
 * rather than a list. Connections are lazy and cached, and the cache is the
 * part that needs care: a cached connection to a dead process is worse than no
 * connection at all, so a channel that closes evicts itself.
 *
 * The registry deliberately does not decide whether a call is allowed. That is
 * the consent layer's job, and keeping the two apart means a dispatch path can
 * never accidentally become an approval path.
 */

import type { McpEra, McpStatus } from '../../shared/mcp.js'
import { err, ok, type Result } from '../../shared/result.js'
import { TOOL_CALL_TIMEOUT_MS, type ToolDefinition } from '../../shared/tools.js'
import { clientFor, handshake, type Client, type ClientInfo } from '../mcp/client.js'
import { connect, type Connection } from '../rpc/connect.js'
import { loopback } from '../rpc/loopback.js'
import type { Transport } from '../rpc/transport.js'
import { BUILTIN_LABEL, BUILTIN_SOURCE, builtinResponder } from './builtin.js'
import { failure, readResult, type CallIdentity, type ToolOutcome } from './result.js'

/**
 * How long one source gets to start, shake hands and list its tools.
 *
 * Sources are started in parallel, so this is the ceiling for the whole
 * catalog rather than a per-source tax. It has to be comfortably above the
 * era probe's own deadline, since a legacy server spends that before it even
 * begins.
 */
export const DISCOVER_TIMEOUT_MS = 20_000

/**
 * How long a source that failed to start is left alone.
 *
 * Without it, a server that hangs would pay its full deadline on every turn.
 * The user can clear it at any time from Settings, and any edit to the server
 * clears it too — this only governs Luna retrying on its own.
 */
export const FAILURE_COOLDOWN_MS = 60_000

export type Source = {
  id: string
  label: string
  /**
   * Built fresh each time the source is started, never shared between starts.
   *
   * Asynchronous because a server's credentials come from platform secure
   * storage, and they are read here — at the moment of spawning — rather than
   * cached. Decrypted secrets then exist only for as long as it takes to hand
   * them to the process that needs them.
   */
  open: () => Promise<Transport>
  /**
   * A previously determined era for this same configuration, if one is stored.
   * A shortcut past the probe, never a commitment — see `handshake`.
   */
  era?: McpEra
  /**
   * Told what the handshake actually concluded, so the next start can skip the
   * probe. Null when a cached verdict turned out to be wrong and should go.
   *
   * The registry has nowhere to write this itself; the source knows where its
   * configuration lives and the registry deliberately does not.
   */
  remember?: (era: McpEra | null) => void
}

/** Self-reported to every server. Unverified by the protocol, and display-only. */
export const CLIENT_INFO: ClientInfo = { name: 'Luna', version: '1' }

export type ToolCall = {
  callId: string
  name: string
  /** Argument JSON as the model produced it. Parsed here, not by the stream. */
  arguments: string
}

/** Luna's own server, always present and never configurable. */
export function builtinSource(): Source {
  return {
    id: BUILTIN_SOURCE,
    label: BUILTIN_LABEL,
    open: () => Promise.resolve(loopback(builtinResponder())),
  }
}

/** One live connection to a source, plus what it said it offers. */
type Live = {
  connection: Connection
  client: Client
  tools: ToolDefinition[]
}

/** What the Settings panel needs to say about a source without asking it. */
export type SourceState = {
  status: McpStatus
  /** Stable code when `status` is 'failed'. */
  errorCode?: string
  era?: McpEra
  version?: string
  serverName?: string
  toolCount: number
}

export type RegistryOptions = {
  now?: () => number
  discoverMs?: number
  cooldownMs?: number
}

export class Registry {
  private readonly live = new Map<string, Live>()
  /** In-flight starts, so two callers cannot spawn the same server twice. */
  private readonly starting = new Map<string, Promise<Result<ToolDefinition[]>>>()
  private readonly state = new Map<string, SourceState>()
  /** When a failed source may be tried again. */
  private readonly cooldown = new Map<string, number>()

  private readonly now: () => number
  private readonly discoverMs: number
  private readonly cooldownMs: number

  constructor(
    private readonly sources: () => readonly Source[],
    options: RegistryOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.discoverMs = options.discoverMs ?? DISCOVER_TIMEOUT_MS
    this.cooldownMs = options.cooldownMs ?? FAILURE_COOLDOWN_MS
  }

  labelOf(source: string): string {
    return this.sources().find((entry) => entry.id === source)?.label ?? source
  }

  /** Everything currently known about every configured source. */
  states(): Map<string, SourceState> {
    const out = new Map<string, SourceState>()
    for (const source of this.sources()) {
      out.set(source.id, this.state.get(source.id) ?? { status: 'idle', toolCount: 0 })
    }
    return out
  }

  /**
   * Connects to a source if it is not already connected, and returns what it
   * offers. Connections are lazy: nothing is started until a tool is wanted.
   */
  async discover(sourceId: string, signal: AbortSignal): Promise<Result<ToolDefinition[]>> {
    const existing = this.live.get(sourceId)
    if (existing !== undefined) return ok(existing.tools)

    const source = this.sources().find((entry) => entry.id === sourceId)
    if (source === undefined) return err('tool/no-source', 'unknown tool source')

    // A second caller joins the first attempt rather than starting a rival
    // process. Two `npx` servers answering the same stdin is not a hypothetical.
    const running = this.starting.get(sourceId)
    if (running !== undefined) return running

    const until = this.cooldown.get(sourceId)
    if (until !== undefined && this.now() < until) {
      return err('tool/cooling-down', 'source failed recently and is not being retried yet')
    }

    const attempt = this.start(source, signal).finally(() => {
      this.starting.delete(sourceId)
    })
    this.starting.set(sourceId, attempt)
    return attempt
  }

  private async start(source: Source, signal: AbortSignal): Promise<Result<ToolDefinition[]>> {
    this.state.set(source.id, { status: 'starting', toolCount: 0 })

    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.discoverMs)])

    let transport: Transport
    try {
      transport = await source.open()
    } catch {
      // Almost always secure storage refusing to decrypt, which is a real
      // failure and not one the model should be told about in detail.
      this.state.set(source.id, {
        status: 'failed',
        errorCode: 'tool/no-credentials',
        toolCount: 0,
      })
      this.cooldown.set(source.id, this.now() + this.cooldownMs)
      return err('tool/no-credentials', 'source credentials were unavailable')
    }

    const connection = connect(transport, {
      timeoutMs: TOOL_CALL_TIMEOUT_MS,
      // A channel that ends takes its cached entry with it, so the next caller
      // starts a fresh process instead of talking to a corpse.
      onClose: () => {
        if (this.live.get(source.id)?.connection !== connection) return
        this.live.delete(source.id)
        this.state.set(source.id, { status: 'idle', toolCount: 0 })
      },
    })

    const fail = async (code: string): Promise<Result<ToolDefinition[]>> => {
      await connection.stop(0)
      this.state.set(source.id, { status: 'failed', errorCode: code, toolCount: 0 })
      this.cooldown.set(source.id, this.now() + this.cooldownMs)
      return err(code, 'source could not be started')
    }

    /** A remembered era that just failed is a wrong answer, so it is dropped. */
    const forgetEra = (): void => {
      if (source.era !== undefined) source.remember?.(null)
    }

    const started = await connection.start(deadline)
    if (!started.ok) return fail(started.code)

    const agreed = await handshake(connection.peer, CLIENT_INFO, deadline, {
      ...(source.era === undefined ? {} : { cached: source.era }),
    })
    if (!agreed.ok) {
      forgetEra()
      return fail(agreed.code)
    }
    if (agreed.value.era !== source.era) source.remember?.(agreed.value.era)

    const client = clientFor(connection.peer, agreed.value, CLIENT_INFO)
    const listed = await client.listTools(deadline)
    if (!listed.ok) return fail(listed.code)

    this.live.set(source.id, { connection, client, tools: listed.value })
    this.cooldown.delete(source.id)
    this.state.set(source.id, {
      status: 'ready',
      era: agreed.value.era,
      version: agreed.value.version,
      ...(agreed.value.serverName === undefined ? {} : { serverName: agreed.value.serverName }),
      toolCount: listed.value.length,
    })
    return ok(listed.value)
  }

  /**
   * Everything every source offers, paired with where it came from.
   *
   * Started in parallel. Serially, the first call after launch would cost the
   * sum of every server's startup, and one slow server would hold up the rest.
   */
  async catalog(signal: AbortSignal): Promise<{ source: string; definition: ToolDefinition }[]> {
    const found = await Promise.all(
      this.sources().map(async (source) => {
        const listed = await this.discover(source.id, signal)
        return listed.ok
          ? listed.value.map((definition) => ({ source: source.id, definition }))
          : []
      }),
    )
    return found.flat()
  }

  /**
   * Drops a source's connection, because its definition changed or it is gone.
   *
   * Called by whoever owns the configuration. The registry cannot notice this
   * on its own — two Source objects built from different rows look identical
   * from here.
   */
  async forget(sourceId: string): Promise<void> {
    const open = this.live.get(sourceId)
    this.live.delete(sourceId)
    this.state.delete(sourceId)
    this.cooldown.delete(sourceId)
    if (open !== undefined) await open.connection.stop(1_000)
  }

  /** Forgets a source and lets it be tried again immediately. */
  async restart(sourceId: string): Promise<void> {
    await this.forget(sourceId)
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
