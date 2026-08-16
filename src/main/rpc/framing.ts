/**
 * Newline-delimited JSON framing over a byte stream.
 *
 * One message per line, UTF-8, and a message may never contain an embedded
 * newline — escaped `\n` inside a JSON string is fine, a literal one is not.
 * This is the framing a JSON-RPC peer speaks over a subprocess's standard
 * streams, and it is equally correct over a socket, so nothing here knows what
 * a transport is.
 *
 * Shaped like SseParser deliberately: strings in, values out, no I/O, so both
 * can be tested by handing them chunk boundaries in awkward places.
 */

/**
 * A single line longer than this is a framing failure rather than something to
 * keep buffering. Without the cap, a peer that never emits a newline grows the
 * buffer until the process dies.
 *
 * Counted in UTF-16 code units, not bytes. This is a safety valve, not an
 * accounting boundary, and encoding every partial line to measure it exactly
 * would cost more than the precision is worth.
 */
export const MAX_LINE_LENGTH = 1_048_576

/** A parsed value, or a marker that the stream desynchronized. */
export type Framed = { ok: true; value: unknown } | { ok: false; reason: 'overflow' | 'malformed' }

export class LineFramer {
  private buffer = ''
  private discarding = false

  /** Values completed by this chunk, in arrival order. */
  push(chunk: string): Framed[] {
    if (chunk === '') return []
    const out: Framed[] = []
    let rest = chunk
    let newline = rest.indexOf('\n')

    while (newline >= 0) {
      const line = this.buffer + rest.slice(0, newline)
      this.buffer = ''
      rest = rest.slice(newline + 1)
      if (this.discarding) {
        // The overflow was already reported; drop the rest of that line only.
        this.discarding = false
      } else {
        const parsed = decode(line)
        if (parsed !== undefined) out.push(parsed)
      }
      newline = rest.indexOf('\n')
    }

    this.buffer += rest
    if (this.buffer.length > MAX_LINE_LENGTH) {
      this.buffer = ''
      this.discarding = true
      out.push({ ok: false, reason: 'overflow' })
    }
    return out
  }

  /**
   * Whatever a closed stream left behind. A peer that exits without a trailing
   * newline still wrote a complete message, and dropping it silently would look
   * like a lost reply rather than a truncated one.
   */
  finish(): Framed[] {
    const line = this.buffer
    this.buffer = ''
    if (this.discarding) {
      this.discarding = false
      return []
    }
    const parsed = decode(line)
    return parsed === undefined ? [] : [parsed]
  }
}

/** Blank lines are padding, not messages, so they produce nothing at all. */
function decode(line: string): Framed | undefined {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
  if (trimmed.trim() === '') return undefined
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}
