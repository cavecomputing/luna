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

export function connect(transport: Transport, options: PeerOptions = {}): Connection {
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
