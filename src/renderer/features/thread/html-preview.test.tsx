// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HtmlPreview, previewDocument } from './html-preview.js'

describe('HtmlPreview', () => {
  it('puts the restrictive policy before untrusted markup', () => {
    const code = '<img src="https://tracker.example/pixel">'
    const document = previewDocument(code)

    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf(code))
    expect(document).toContain("default-src 'none'")
    expect(document).toContain("script-src 'none'")
    expect(document).toContain("connect-src 'none'")
    expect(document).toContain("form-action 'none'")
    expect(document).toContain('<base target="_blank">')
  })

  it('renders only after an explicit toggle in a sandbox without same-origin access', () => {
    render(<HtmlPreview code="<h1>Hello</h1>" />)

    fireEvent.click(screen.getByRole('button', { name: 'Render' }))
    const frame = screen.getByTitle('Rendered HTML preview')
    expect(frame.getAttribute('sandbox')).toBe('allow-popups')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Hello</h1>')
    expect(screen.getByRole('button', { name: 'Render' }).getAttribute('aria-pressed')).toBe('true')
  })
})
