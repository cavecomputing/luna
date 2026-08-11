// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ShortcutsApp } from './shortcuts-app.js'

describe('ShortcutsApp', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'luna', {
      configurable: true,
      value: { platform: 'darwin' },
    })
  })

  it('shows the settings and shortcut accelerators', () => {
    render(<ShortcutsApp />)

    expect(screen.getByText('Toggle sidebar').nextElementSibling?.textContent).toBe('⌘B')
    expect(screen.getByText('Toggle Fast / Expert mode').nextElementSibling?.textContent).toBe(
      '⌘⇧M',
    )
    expect(screen.getByText('Open Settings').nextElementSibling?.textContent).toBe('⌘,')
    expect(screen.getByText('Keyboard shortcuts').nextElementSibling?.textContent).toBe('⌘?')
  })

  it('keeps a fixed title-bar spacer outside the scrolling content', () => {
    const { container } = render(<ShortcutsApp />)
    const main = container.querySelector('main')

    expect(main?.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
    expect(main?.lastElementChild?.querySelector('h1')?.textContent).toBe('Keyboard Shortcuts')
  })
})
