/**
 * A transport whose far side is a function in this process.
 *
 * This is not a test double. Luna's built-in tools are served through it, which
 * means they exercise the same framing, correlation, timeout, and cancellation
 * paths as anything reached over a pipe. A built-in that bypassed the peer and
 * called a function directly would prove none of that worked.
 *
 * The responder is handed raw lines and answers with raw lines, so it sees
 * exactly what a subprocess would.
 */

import { ok, type Result } from '../../shared/result.js'
import type { CloseReason, Transport } from './transport.js'

export type Responder = (line: string, reply: (line: string) => void) => void

export function loopback(respond: Responder): Transport {
  let lines: ((line: string) => void) | undefined
  let closes: ((reason: CloseReason) => void) | undefined
  let running = false

  return {
    // Nothing to bring up, so there is nothing an abort could interrupt. The
    // signal is deliberately ignored rather than wired to a close: it outlives
    // this call, and a caller cancelling later must not take the channel down.
    start: (): Promise<Result<undefined>> => {
      running = true
      return Promise.resolve(ok(undefined))
    },

    send: (line: string): void => {
      if (!running) return
      // Answers are delivered on a later turn of the event loop, so a responder
      // can never resolve a request before `request()` has registered it. The
      // delimiter goes on here too, so the reader frames these exactly as it
      // would frame bytes off a pipe.
      respond(line, (answer) => {
        if (!running) return
        queueMicrotask(() => {
          if (running) lines?.(`${answer}\n`)
        })
      })
    },

    onData: (fn: (chunk: string) => void): void => {
      lines = fn
    },

    onClose: (fn: (reason: CloseReason) => void): void => {
      closes = fn
    },

    stop: (): Promise<void> => {
      if (running) {
        running = false
        closes?.({ kind: 'stopped' })
      }
      return Promise.resolve()
    },
  }
}
