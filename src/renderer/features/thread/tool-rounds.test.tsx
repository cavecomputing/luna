// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolRound, ToolStep } from '../../../shared/types.js'
import { ToolRounds } from './tool-rounds.js'

afterEach(cleanup)

function step(over: Partial<ToolStep> = {}): ToolStep {
  return {
    callId: 'call-1',
    source: 'builtin',
    name: 'luna_echo',
    arguments: '{"text":"hi"}',
    text: 'hi',
    isError: false,
    truncated: false,
    ...over,
  }
}

function round(over: Partial<ToolRound> = {}): ToolRound {
  return { text: 'Checking.', steps: [step()], ...over }
}

describe('ToolRounds', () => {
  it('renders nothing when a turn made no calls', () => {
    const { container } = render(<ToolRounds rounds={[{ text: 'x', steps: [] }]} />)
    expect(container.innerHTML).toBe('')
  })

  it('counts the calls across every round', () => {
    render(<ToolRounds rounds={[round(), round({ steps: [step(), step()] })]} />)
    expect(screen.getByText(/3 tool calls/)).toBeDefined()
  })

  it('uses the singular for one call', () => {
    render(<ToolRounds rounds={[round()]} />)
    expect(screen.getByText(/1 tool call/)).toBeDefined()
  })

  it('reports how many failed', () => {
    render(<ToolRounds rounds={[round({ steps: [step(), step({ isError: true })] })]} />)
    expect(screen.getByText(/1 failed/)).toBeDefined()
  })

  it('shows the tool name, source, arguments, and result', () => {
    render(<ToolRounds rounds={[round()]} />)
    expect(screen.getByText('luna_echo')).toBeDefined()
    expect(screen.getByText('builtin')).toBeDefined()
    expect(screen.getByText(/"text": "hi"/)).toBeDefined()
  })

  it('falls back to the raw string when the model wrote invalid JSON', () => {
    render(<ToolRounds rounds={[round({ steps: [step({ arguments: '{not json' })] })]} />)
    expect(screen.getByText('{not json')).toBeDefined()
  })

  it('names non-text parts instead of rendering them', () => {
    render(
      <ToolRounds
        rounds={[
          round({
            steps: [step({ parts: [{ kind: 'image', mediaType: 'image/png', size: 100 }] })],
          }),
        ]}
      />,
    )
    expect(screen.getByText(/image \(image\/png\)/)).toBeDefined()
  })

  it('says when a result was truncated', () => {
    render(<ToolRounds rounds={[round({ steps: [step({ truncated: true })] })]} />)
    expect(screen.getByText('Result truncated.')).toBeDefined()
  })

  /**
   * Tool output is attacker-controlled. It must reach the DOM as text and
   * nothing else — never markdown, never the sandboxed HTML preview.
   */
  describe('untrusted output', () => {
    it('renders markup in a result as literal text', () => {
      const hostile = '<img src=x onerror=alert(1)> **not bold**'
      const { container } = render(
        <ToolRounds rounds={[round({ steps: [step({ text: hostile })] })]} />,
      )

      expect(screen.getByText(hostile)).toBeDefined()
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('strong')).toBeNull()
    })

    it('renders markup in arguments as literal text', () => {
      const hostile = '<script>alert(1)</script>'
      const { container } = render(
        <ToolRounds rounds={[round({ steps: [step({ arguments: hostile })] })]} />,
      )

      expect(screen.getByText(hostile)).toBeDefined()
      expect(container.querySelector('script')).toBeNull()
    })

    it('never opens a preview frame for tool output', () => {
      const { container } = render(
        <ToolRounds
          rounds={[round({ steps: [step({ text: '```html\n<b>hi</b>\n```' })] })]}
        />,
      )
      expect(container.querySelector('iframe')).toBeNull()
    })

    it('keeps a result inside a scrollable box rather than widening the thread', () => {
      const { container } = render(
        <ToolRounds rounds={[round({ steps: [step({ text: 'x'.repeat(5_000) })] })]} />,
      )
      // A <pre> is the only element carrying result text; the stylesheet caps
      // and scrolls it, so the assertion here is that it is preformatted.
      expect(container.querySelectorAll('pre').length).toBeGreaterThan(0)
    })
  })
})
