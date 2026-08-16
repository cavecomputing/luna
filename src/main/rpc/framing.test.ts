import { describe, expect, it } from 'vitest'
import { LineFramer, MAX_LINE_LENGTH } from './framing.js'

function values(framer: LineFramer, chunks: string[]): unknown[] {
  const out: unknown[] = []
  for (const chunk of chunks) {
    for (const framed of framer.push(chunk)) if (framed.ok) out.push(framed.value)
  }
  return out
}

describe('LineFramer', () => {
  it('parses one value per line', () => {
    const framer = new LineFramer()
    expect(values(framer, ['{"a":1}\n{"b":2}\n'])).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('assembles a value split across chunks in the middle of a token', () => {
    const framer = new LineFramer()
    expect(values(framer, ['{"met', 'hod":"tools/li', 'st"}\n'])).toEqual([
      { method: 'tools/list' },
    ])
  })

  it('assembles a value split exactly at the newline', () => {
    const framer = new LineFramer()
    expect(values(framer, ['{"a":1}', '\n{"b":2}\n'])).toEqual([{ a: 1 }, { b: 2 }])
  })

  /**
   * The wire format forbids a literal newline inside a message. An escaped one
   * inside a JSON string is a different thing and must survive intact.
   */
  it('keeps an escaped newline inside a string', () => {
    const framer = new LineFramer()
    expect(values(framer, ['{"text":"first\\nsecond"}\n'])).toEqual([
      { text: 'first\nsecond' },
    ])
  })

  it('tolerates CRLF line endings', () => {
    const framer = new LineFramer()
    expect(values(framer, ['{"a":1}\r\n{"b":2}\r\n'])).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('ignores blank padding lines', () => {
    const framer = new LineFramer()
    expect(values(framer, ['\n\n{"a":1}\n\n'])).toEqual([{ a: 1 }])
  })

  it('reports a malformed line without dropping the next good one', () => {
    const framer = new LineFramer()
    const framed = framer.push('not json\n{"a":1}\n')
    expect(framed[0]).toEqual({ ok: false, reason: 'malformed' })
    expect(framed[1]).toEqual({ ok: true, value: { a: 1 } })
  })

  it('surfaces a trailing value left by a stream that closed without a newline', () => {
    const framer = new LineFramer()
    expect(framer.push('{"a":1}')).toEqual([])
    expect(framer.finish()).toEqual([{ ok: true, value: { a: 1 } }])
  })

  it('finishes empty when the stream closed on a clean boundary', () => {
    const framer = new LineFramer()
    framer.push('{"a":1}\n')
    expect(framer.finish()).toEqual([])
  })

  /** Without this a peer that never sends a newline grows the buffer forever. */
  it('reports overflow instead of buffering an unbounded line', () => {
    const framer = new LineFramer()
    const framed = framer.push(`{"a":"${'x'.repeat(MAX_LINE_LENGTH + 1)}`)
    expect(framed).toEqual([{ ok: false, reason: 'overflow' }])
  })

  it('resynchronizes on the next line after an overflow', () => {
    const framer = new LineFramer()
    framer.push('x'.repeat(MAX_LINE_LENGTH + 1))
    expect(values(framer, ['leftover-of-the-bad-line\n{"a":1}\n'])).toEqual([{ a: 1 }])
  })
})
