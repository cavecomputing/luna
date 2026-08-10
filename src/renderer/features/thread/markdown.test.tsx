// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Markdown } from './markdown.js'

describe('Markdown', () => {
  it('renders CommonMark and GFM structures', () => {
    const { container } = render(
      <Markdown
        text={'# Heading\n\n**Bold** and `code`\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |'}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy()
    expect(container.querySelector('strong')?.textContent).toBe('Bold')
    expect(container.querySelector('code')?.textContent).toBe('code')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('allows HTTPS links and removes unsafe link protocols and raw HTML', () => {
    const { container } = render(
      <Markdown
        text={'[Safe](https://example.com) [Bad](javascript:alert(1)) <strong>raw</strong>'}
      />,
    )

    const safe = screen.getByRole('link', { name: 'Safe' })
    expect(safe.getAttribute('href')).toBe('https://example.com')
    expect(safe.getAttribute('target')).toBe('_blank')
    expect(screen.queryByRole('link', { name: 'Bad' })).toBeNull()
    expect(container.querySelector('strong')).toBeNull()
  })

  it('turns fenced HTML into a source-first preview surface', () => {
    render(<Markdown text={'```html\n<h1>Hello</h1>\n```'} />)

    const block = screen.getByRole('region', { name: 'HTML code block' })
    expect(within(block).getByText('<h1>Hello</h1>')).toBeTruthy()
    expect(within(block).getByRole('button', { name: 'Source' }).getAttribute('aria-pressed'))
      .toBe('true')
    expect(within(block).queryByTitle('Rendered HTML preview')).toBeNull()
  })

  it('copies an entire fenced code block at once', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<Markdown text={'```ts\nconst answer = 42\n```'} />)

    const block = screen.getByRole('region', { name: 'TS code block' })
    fireEvent.click(within(block).getByRole('button', { name: 'Copy code' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('const answer = 42')
    })
    expect(within(block).getByRole('button', { name: 'Code copied' })).toBeTruthy()
  })

  it('offers a retry when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<Markdown text={'```\nprivate value\n```'} />)

    const block = screen.getByRole('region', { name: 'Code block' })
    fireEvent.click(within(block).getByRole('button', { name: 'Copy code' }))

    expect(await within(block).findByRole('button', { name: 'Copy failed, retry' })).toBeTruthy()
  })
})
