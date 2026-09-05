import { describe, expect, it } from 'vitest'
import { MAX_STORED_TOOL_RESULT_CHARS, MAX_TOOL_RESULT_CHARS } from '../../shared/tools.js'
import { failure, readResult, sanitize, type CallIdentity } from './result.js'

const ESC = String.fromCharCode(27)
const BELL = String.fromCharCode(7)

const identity: CallIdentity = {
  callId: 'call-1',
  source: 'builtin',
  name: 'luna_echo',
  arguments: '{"text":"hi"}',
}

function complete(extra: Record<string, unknown>): unknown {
  return { resultType: 'complete', ...extra }
}

describe('sanitize', () => {
  it('strips colour and cursor escape sequences', () => {
    expect(sanitize(`${ESC}[31mred${ESC}[0m`)).toBe('red')
  })

  it('strips the OSC introducer and bell', () => {
    expect(sanitize(`${ESC}]0;retitled${BELL}text`)).toBe('0;retitledtext')
  })

  it('keeps tab and newline', () => {
    expect(sanitize('a\tb\nc')).toBe('a\tb\nc')
  })

  /**
   * A lone carriage return puts the cursor back at the start of the line, so
   * later text overwrites earlier text. That shows a person one thing while the
   * model was handed another.
   */
  it('strips carriage returns so text cannot be overwritten', () => {
    expect(sanitize('real answer\rfake answer')).toBe('real answerfake answer')
  })

  it('strips null and other C0 controls', () => {
    expect(sanitize(`a${String.fromCharCode(0)}b${String.fromCharCode(8)}c`)).toBe('abc')
  })

  it('strips bidirectional overrides that can visually reorder untrusted text', () => {
    expect(sanitize('safe\u202eforged\u2066text')).toBe('safeforgedtext')
  })

  it('leaves ordinary text alone', () => {
    expect(sanitize('Plain text — with punctuation.')).toBe('Plain text — with punctuation.')
  })
})

describe('readResult', () => {
  it('flattens text content and reports success', () => {
    const outcome = readResult(identity, complete({ content: [{ type: 'text', text: 'hello' }] }))
    expect(outcome.modelText).toBe('hello')
    expect(outcome.step).toMatchObject({ text: 'hello', isError: false, truncated: false })
  })

  it('joins several text parts', () => {
    const outcome = readResult(
      identity,
      complete({ content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }),
    )
    expect(outcome.modelText).toBe('one\ntwo')
  })

  it('sanitizes text before it reaches the model or the transcript', () => {
    const outcome = readResult(
      identity,
      complete({ content: [{ type: 'text', text: `${ESC}[31mdanger${ESC}[0m` }] }),
    )
    expect(outcome.modelText).toBe('danger')
    expect(outcome.step.text).toBe('danger')
  })

  it('marks a tool-reported error without failing the call', () => {
    const outcome = readResult(
      identity,
      complete({ content: [{ type: 'text', text: 'Date must be future.' }], isError: true }),
    )
    expect(outcome.step.isError).toBe(true)
    expect(outcome.modelText).toBe('Date must be future.')
  })

  it('keeps structured content whole, including null', () => {
    const outcome = readResult(identity, complete({ structuredContent: { a: 1, b: null } }))
    expect(outcome.step.structured).toEqual({ a: 1, b: null })
  })

  it('omits structured content entirely when the tool sent none', () => {
    const outcome = readResult(identity, complete({ content: [] }))
    expect('structured' in outcome.step).toBe(false)
  })

  describe('non-text parts', () => {
    it('records an image as a reference and never its bytes', () => {
      const outcome = readResult(
        identity,
        complete({
          content: [{ type: 'image', data: 'AAAABBBBCCCC', mimeType: 'image/png' }],
        }),
      )
      expect(outcome.step.parts).toEqual([
        { kind: 'image', mediaType: 'image/png', size: 12 },
      ])
      expect(JSON.stringify(outcome.step)).not.toContain('AAAABBBB')
    })

    it('records a resource link and its uri', () => {
      const outcome = readResult(
        identity,
        complete({
          content: [{ type: 'resource_link', uri: 'file:///project/main.rs', name: 'main.rs' }],
        }),
      )
      expect(outcome.step.parts).toEqual([
        { kind: 'resource_link', uri: 'file:///project/main.rs' },
      ])
    })

    it('records an embedded resource without inlining its text', () => {
      const outcome = readResult(
        identity,
        complete({
          content: [{
            type: 'resource',
            resource: { uri: 'file:///a.rs', text: 'fn main() {}', mimeType: 'text/x-rust' },
          }],
        }),
      )
      expect(outcome.step.parts).toEqual([
        { kind: 'resource', mediaType: 'text/x-rust', uri: 'file:///a.rs' },
      ])
      expect(outcome.modelText).toBe('[resource omitted]')
    })

    /** Silence and success must not look the same to the model. */
    it('describes omitted parts when there was no text at all', () => {
      const outcome = readResult(
        identity,
        complete({ content: [{ type: 'image', data: 'AA', mimeType: 'image/png' }] }),
      )
      expect(outcome.modelText).toBe('[image omitted]')
    })

    it('ignores a content entry of an unknown type', () => {
      const outcome = readResult(
        identity,
        complete({ content: [{ type: 'video', data: 'AA' }, { type: 'text', text: 'ok' }] }),
      )
      expect(outcome.step.parts).toBeUndefined()
      expect(outcome.modelText).toBe('ok')
    })
  })

  describe('bounds', () => {
    /**
     * The cap is a ceiling, not an approximation. The truncation marker comes
     * out of the budget rather than being added to it — a limit the value
     * overshoots by the length of its own footnote is not a limit.
     */
    it('caps stored text harder than model text and marks it truncated', () => {
      const huge = 'x'.repeat(MAX_TOOL_RESULT_CHARS + 10)
      const outcome = readResult(identity, complete({ content: [{ type: 'text', text: huge }] }))

      expect(outcome.step.truncated).toBe(true)
      expect(outcome.step.text.length).toBeLessThanOrEqual(MAX_STORED_TOOL_RESULT_CHARS)
      expect(outcome.modelText.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS)
      expect(outcome.step.text).toContain('[truncated]')
    })

    it('leaves text exactly at the cap alone', () => {
      const exact = 'x'.repeat(MAX_TOOL_RESULT_CHARS)
      const outcome = readResult(identity, complete({ content: [{ type: 'text', text: exact }] }))

      expect(outcome.modelText).toBe(exact)
      expect(outcome.modelText.length).toBe(MAX_TOOL_RESULT_CHARS)
    })

    it('cuts one character over the cap down to it', () => {
      const over = 'x'.repeat(MAX_TOOL_RESULT_CHARS + 1)
      const outcome = readResult(identity, complete({ content: [{ type: 'text', text: over }] }))

      expect(outcome.modelText.length).toBe(MAX_TOOL_RESULT_CHARS)
      expect(outcome.modelText.endsWith('[truncated]')).toBe(true)
    })

    it('does not mark ordinary output as truncated', () => {
      const outcome = readResult(identity, complete({ content: [{ type: 'text', text: 'ok' }] }))
      expect(outcome.step.truncated).toBe(false)
    })
  })

  describe('unsupported shapes', () => {
    /**
     * Honouring input_required means driving a form from a server-supplied
     * schema. Telling the model instead lets it route around the tool.
     */
    it('reports an input_required result as a recoverable tool error', () => {
      const outcome = readResult(identity, { resultType: 'input_required', inputRequests: {} })
      expect(outcome.step.isError).toBe(true)
      expect(outcome.modelText).toContain('interactive input')
    })

    it('reports a non-object result as a tool error', () => {
      expect(readResult(identity, 'nonsense').step.isError).toBe(true)
    })

    it('treats a missing content array as empty rather than throwing', () => {
      const outcome = readResult(identity, complete({}))
      expect(outcome.modelText).toBe('')
      expect(outcome.step.isError).toBe(false)
    })
  })

  it('carries the call identity through unchanged', () => {
    const outcome = readResult(identity, complete({ content: [] }))
    expect(outcome.step).toMatchObject({
      callId: 'call-1',
      source: 'builtin',
      name: 'luna_echo',
      arguments: '{"text":"hi"}',
    })
  })
})

describe('failure', () => {
  it('produces a tool error the model can read', () => {
    const outcome = failure(identity, 'No such tool.')
    expect(outcome.step.isError).toBe(true)
    expect(outcome.modelText).toBe('No such tool.')
    expect(outcome.step.callId).toBe('call-1')
  })
})
