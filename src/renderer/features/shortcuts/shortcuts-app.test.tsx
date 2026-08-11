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
    expect(screen.getByText('Open Settings').nextElementSibling?.textContent).toBe('⌘,')
    expect(screen.getByText('Keyboard shortcuts').nextElementSibling?.textContent).toBe('⌘?')
  })
})
