import { describe, expect, it } from 'vitest'
import { SseParser } from './sse.js'

describe('SseParser', () => {
  it('assembles events split across arbitrary chunks', () => {
    const parser = new SseParser()
    expect(parser.push('event: response.output_')).toEqual([])
    expect(parser.push('text.delta\r\ndata: {"delta":"Hel')).toEqual([])
    expect(parser.push('lo"}\r\n\r\n')).toEqual([
      {
        event: 'response.output_text.delta',
        data: '{"delta":"Hello"}',
      },
    ])
  })

  it('joins data lines and ignores comments', () => {
    const parser = new SseParser()
    expect(parser.push(': keepalive\n')).toEqual([])
    expect(parser.push('data: first\ndata: second\n\n')).toEqual([
      { data: 'first\nsecond' },
    ])
  })

  it('flushes a final event without a blank line', () => {
    const parser = new SseParser()
    parser.push('data: [DONE]')
    expect(parser.finish()).toEqual([{ data: '[DONE]' }])
  })

  it('accepts streams that use bare CR line endings', () => {
    const parser = new SseParser()
    expect(parser.push('data: first\r\rdata: second\r\r')).toEqual([{ data: 'first' }])
    expect(parser.finish()).toEqual([{ data: 'second' }])
  })

  it('treats CRLF split across chunks as one line ending', () => {
    const parser = new SseParser()
    expect(parser.push('data: split\r')).toEqual([])
    expect(parser.push('')).toEqual([])
    expect(parser.push('\n\r')).toEqual([])
    expect(parser.push('\n')).toEqual([{ data: 'split' }])
  })
})
