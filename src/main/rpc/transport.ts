/**
 * How a JSON-RPC peer's bytes get where they are going.
 *
 * The peer speaks lines; a transport decides what carries them — a subprocess's
 * standard streams today, an HTTP endpoint or a socket later. Keeping that seam
 * here is what makes adding a second one a new file rather than a refactor.
 *
 * Nothing in this folder may name a protocol built on top of it.
 */

import type { Result } from '../../shared/result.js'

export type CloseReason =
  /** The peer ended on its own, with whatever exit status it had. */
  | { kind: 'exit'; code: number | null }
  /** The channel failed underneath us. */
  | { kind: 'error' }
  /** We asked it to stop. */
  | { kind: 'stopped' }

export type Transport = {
  /**
   * Brings the channel up. Resolving means lines can be sent, not that anything
   * has answered — a protocol handshake is the layer above's business.
   */
  start: (signal: AbortSignal) => Promise<Result<undefined>>
  /** One complete message. The transport appends the delimiter. */
  send: (line: string) => void
  /**
   * Raw received text, in whatever sizes the channel produced it.
   *
   * Deliberately asymmetric with `send`: writing is message-oriented because we
   * control it, reading is stream-oriented because we do not. A chunk may hold
   * several messages, half of one, or a split in the middle of a token, so
   * framing is the reader's job and lives in exactly one place.
   */
  onData: (fn: (chunk: string) => void) => void
  onClose: (fn: (reason: CloseReason) => void) => void
  /**
   * Shuts the channel down, allowing `grace` milliseconds for a polite exit
   * before forcing one. Resolves once the channel is really gone.
   */
  stop: (grace: number) => Promise<void>
}
