/**
 * Joins a transport's bytes to a JSON-RPC peer.
 *
 * Kept apart from both so `jsonrpc.ts` stays pure protocol with no notion of a
 * stream, and `transport.ts` stays a bare interface with no notion of JSON-RPC.
 * This is the only place that knows both exist.
 */

import type { Result } from '../../shared/result.js'
import { LineFramer } from './framing.js'
import { JsonRpcPeer, type PeerOptions } from './jsonrpc.js'
import type { CloseReason, Transport } from './transport.js'

export type Connection = {
  peer: JsonRpcPeer
  /** Brings the transport up. The peer is usable only after this succeeds. */
  start: (signal: AbortSignal) => Promise<Result<undefined>>
  stop: (grace: number) => Promise<void>
}

export type ConnectOptions = PeerOptions & {
  /**
   * Told when the channel ends, however it ended.
   *
   * The peer alone cannot say this: it fails the requests that were waiting,
   * but nobody learns that an idle connection has died. A caller holding one in
   * a cache needs to know, or it hands out a corpse.
   */
  onClose?: (reason: CloseReason) => void
}

export function connect(transport: Transport, options: ConnectOptions = {}): Connection {
  const framer = new LineFramer()
  const peer = new JsonRpcPeer((line) => {
    transport.send(line)
  }, options)

  transport.onData((chunk) => {
    for (const framed of framer.push(chunk)) {
      // A line we cannot decode is skipped rather than fatal. The peer that
      // sent it may still answer the next request correctly, and the request
      // this one belonged to fails on its own deadline.
      if (framed.ok) peer.receive(framed.value)
    }
  })

  transport.onClose((reason: CloseReason) => {
    for (const framed of framer.finish()) {
      if (framed.ok) peer.receive(framed.value)
    }
    peer.close(reason.kind === 'exit' ? 'peer exited' : 'channel closed')
    options.onClose?.(reason)
  })

  return {
    peer,
    start: (signal) => transport.start(signal),
    stop: async (grace) => {
      await transport.stop(grace)
      peer.close('stopped')
    },
  }
}
