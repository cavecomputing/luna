// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CodeBlock } from './code-block.js'

describe('CodeBlock', () => {
  it('marks up a known language with highlight spans', () => {
    render(<CodeBlock className="language-ts" code={'const answer = 42\n'} />)

    const block = screen.getByRole('region', { name: 'TS code block' })
    expect(within(block).getByText('const').className).toContain('hljs-keyword')
    expect(within(block).getByText('42').className).toContain('hljs-number')
    // The copy source stays the raw text, spans are presentation only.
    expect(within(block).getByRole('button', { name: 'Copy code' })).toBeTruthy()
  })

  it('renders an unknown language as plain text', () => {
    render(<CodeBlock className="language-madeuplang" code={'nothing to color\n'} />)

    const block = screen.getByRole('region', { name: 'MADEUPLANG code block' })
    expect(block.querySelector('[class*="hljs-"]')).toBeNull()
    expect(within(block).getByText('nothing to color')).toBeTruthy()
  })

  it('renders a language-less block as plain text', () => {
    render(<CodeBlock code={'plain\n'} />)

    const block = screen.getByRole('region', { name: 'Code block' })
    expect(block.querySelector('[class*="hljs-"]')).toBeNull()
  })
})
