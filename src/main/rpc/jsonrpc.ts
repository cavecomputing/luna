/**
 * A JSON-RPC 2.0 client peer.
 *
 * Deliberately one-directional for requests: this side sends requests and
 * notifications and receives responses and notifications. It never answers an
 * inbound request. A peer that sent us one has violated its own contract, and
 * replying would mean writing a response back up a channel that is not supposed
 * to carry one, so those are counted and dropped.
 *
 * Pure protocol. It is handed a `send` function and fed received values; it
 * owns no stream, no process, and no timers beyond its own request deadlines.
 *
 * Two result surfaces, deliberately. `request` answers a `Result`, which is what
 * almost every caller wants and what the rest of Luna speaks. `call` answers an
 * `RpcOutcome` carrying the peer's own error code and `data`, which a protocol
 * built on top may need to branch on — MCP decides a server's era from exactly
 * that payload. `request` is a mapping of `call`, so there is one code path.
 */

import { err, ok, type Result } from '../../shared/result.js'
import { object } from '../parse.js'

/** Default ceiling on a single request. Callers can lower it per peer. */
export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * What became of one request, before it is flattened into a `Result`.
 *
 * `error` is the far side answering in JSON-RPC terms and keeps its `code` and
 * `data` intact; everything else happened on this side. Keeping them apart
 * matters because a caller acting on a peer's error code must not mistake a
 * local timeout for one.
 */
export type RpcOutcome =
  | { kind: 'ok'; value: unknown }
  | { kind: 'error'; code: number; message: string; data: unknown }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'closed'; reason: string }
  | { kind: 'write' }

type Pending = {
  resolve: (outcome: RpcOutcome) => void
  timer: ReturnType<typeof setTimeout>
  detach: () => void
}

export type PeerOptions = {
  timeoutMs?: number
  /** Injected so tests drive deadlines without a real clock. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

export class JsonRpcPeer {
  private readonly pending = new Map<number, Pending>()
  private readonly timeoutMs: number
  private readonly setTimer: NonNullable<PeerOptions['setTimer']>
  private readonly clearTimer: NonNullable<PeerOptions['clearTimer']>
  private notify_: ((method: string, params: unknown) => void) | undefined
  private nextId = 1
  private closed = false

  /** Inbound requests, which this peer must not answer. Surfaced for tests. */
  public unexpectedRequests = 0

  constructor(
    private readonly write: (line: string) => void,
    options: PeerOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.setTimer = options.setTimer ?? setTimeout
    this.clearTimer = options.clearTimer ?? clearTimeout
  }

  /**
   * Sends a request and waits for its response, reporting the raw outcome.
   *
   * Aborting does not merely stop waiting: it tells the far side to stop too,
   * with a `notifications/cancelled` referencing the id. A purely local abort
   * leaves the peer doing work nobody will read.
   */
  async call(method: string, params: unknown, signal?: AbortSignal): Promise<RpcOutcome> {
    if (this.closed) return { kind: 'closed', reason: 'peer is closed' }
    if (signal?.aborted === true) return { kind: 'cancelled' }

    const id = this.nextId
    this.nextId += 1

    return new Promise<RpcOutcome>((resolve) => {
      const settle = (outcome: RpcOutcome): void => {
        const entry = this.pending.get(id)
        if (entry === undefined) return
        this.pending.delete(id)
        this.clearTimer(entry.timer)
        entry.detach()
        resolve(outcome)
      }

      const onAbort = (): void => {
        this.cancel(id)
        settle({ kind: 'cancelled' })
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      this.pending.set(id, {
        resolve: settle,
        timer: this.setTimer(() => {
          this.cancel(id)
          settle({ kind: 'timeout' })
        }, this.timeoutMs),
        detach: () => {
          signal?.removeEventListener('abort', onAbort)
        },
      })

      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch {
        settle({ kind: 'write' })
      }
    })
  }

  /**
   * `call`, flattened to the `Result` the rest of Luna speaks.
   *
   * The peer's numeric code lands in the message rather than the code, because
   * `Err.code` is what callers switch on and it has to stay a small closed set.
   * A caller that genuinely needs the number wants `call`.
   */
  async request(method: string, params: unknown, signal?: AbortSignal): Promise<Result<unknown>> {
    const outcome = await this.call(method, params, signal)
    switch (outcome.kind) {
      case 'ok':
        return ok(outcome.value)
      case 'error':
        return err('rpc/error', `peer returned error ${String(outcome.code)}`)
      case 'timeout':
        return err('rpc/timeout', `${method} timed out`)
      case 'cancelled':
        return err('rpc/cancelled', 'cancelled')
      case 'closed':
        return err('rpc/closed', outcome.reason)
      case 'write':
        return err('rpc/write', 'request could not be written')
    }
  }

  /** Fire and forget. No id, so nothing correlates and nothing waits. */
  notify(method: string, params?: unknown): void {
    if (this.closed) return
    try {
      this.send({
        jsonrpc: '2.0',
        method,
        ...(params === undefined ? {} : { params }),
      })
    } catch {
      // Notifications are best-effort and have no caller waiting for a Result.
    }
  }

  /** Progress, logging, and subscription pushes all arrive this way. */
  onNotification(fn: (method: string, params: unknown) => void): void {
    this.notify_ = fn
  }

  /** Feed one decoded message in. Anything unrecognizable is ignored. */
  receive(message: unknown): void {
    const cell = object(message)
    if (cell === undefined) return

    if (typeof cell.method === 'string') {
      // A request carries an id; a notification does not. Only the latter is
      // legal from the far side, so the former is recorded and dropped.
      if (cell.id === undefined || cell.id === null) this.notify_?.(cell.method, cell.params)
      else this.unexpectedRequests += 1
      return
    }

    if (typeof cell.id !== 'number') return
    const entry = this.pending.get(cell.id)
    // Late arrivals — a response to something already timed out or cancelled —
    // find nothing here, which is exactly how they get discarded.
    if (entry === undefined) return

    const failure = object(cell.error)
    if (failure !== undefined) {
      entry.resolve({
        kind: 'error',
        code: typeof failure.code === 'number' ? failure.code : 0,
        // Kept for a caller that must branch on it. Never logged: an error
        // message from outside can carry a path or user content.
        message: typeof failure.message === 'string' ? failure.message : '',
        data: failure.data,
      })
      return
    }
    entry.resolve({ kind: 'ok', value: cell.result })
  }

  /**
   * Fails every request still waiting.
   *
   * This is the guarantee that a dead peer surfaces as an error instead of a
   * caller that never resumes.
   */
  close(reason = 'peer closed'): void {
    this.closed = true
    for (const [id] of [...this.pending]) {
      this.pending.get(id)?.resolve({ kind: 'closed', reason })
    }
    this.pending.clear()
  }

  private cancel(id: number): void {
    if (this.closed) return
    try {
      this.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } })
    } catch {
      // Local cancellation still settles the request when the channel is gone.
    }
  }

  private send(message: unknown): void {
    // A message may never contain a literal newline; JSON.stringify escapes any
    // that appear inside strings, which is what keeps one message on one line.
    this.write(JSON.stringify(message))
  }
}
