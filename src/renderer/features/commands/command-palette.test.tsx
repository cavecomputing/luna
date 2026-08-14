// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dialogStyles from '../../ui/dialog.module.css'
import { CommandPalette } from './command-palette.js'
import type { Command } from './commands.js'

afterEach(cleanup)

function commands(run = vi.fn()): Command[] {
  return [
    { id: 'new-chat', label: 'New chat', shortcut: 'newChat', run },
    { id: 'search', label: 'Search conversations', hint: 'find', run: () => undefined },
    { id: 'settings', label: 'Open Settings', shortcut: 'settings', run: () => undefined },
  ]
}

describe('CommandPalette', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'luna', {
      configurable: true,
      value: { platform: 'darwin' },
    })
  })

  it('moves through commands with arrows and runs the active one', () => {
    const run = vi.fn()
    const close = vi.fn()
    render(<CommandPalette commands={commands(run)} onClose={close} />)
    const input = screen.getByRole('combobox', { name: 'Run a command' })
    const options = screen.getAllByRole('option')

    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(run).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('narrows the list as the query is typed', () => {
    render(<CommandPalette commands={commands()} onClose={() => undefined} />)
    const input = screen.getByRole('combobox', { name: 'Run a command' })

    fireEvent.change(input, { target: { value: 'find' } })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Search conversations',
    ])

    fireEvent.change(input, { target: { value: 'nothing here' } })
    expect(screen.queryAllByRole('option')).toEqual([])
    expect(screen.getByText('No matching commands')).toBeTruthy()
  })

  it('runs a command clicked with the mouse', () => {
    const run = vi.fn()
    render(<CommandPalette commands={commands(run)} onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('option', { name: /New chat/ }))
    expect(run).toHaveBeenCalledOnce()
  })

  it('shows each command its own accelerator for this platform', () => {
    render(<CommandPalette commands={commands()} onClose={() => undefined} />)

    expect(screen.getByRole('option', { name: /New chat/ }).textContent).toContain('⌘N')
    expect(screen.getByRole('option', { name: /Open Settings/ }).textContent).toContain('⌘,')
  })

  it('closes from its button', () => {
    const close = vi.fn()
    render(<CommandPalette commands={commands()} onClose={close} />)

    const closeButton = screen.getByRole('button', { name: 'Close command palette' })
    expect(closeButton.textContent).toBe('Esc')
    fireEvent.click(closeButton)
    expect(close).toHaveBeenCalledOnce()
  })

  it('opens in the center of the window', () => {
    render(<CommandPalette commands={commands()} onClose={() => undefined} />)

    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    const center = dialogStyles.center
    if (center === undefined) throw new Error('Missing center dialog style')
    expect(dialog.parentElement?.classList.contains(center)).toBe(true)
  })

  it('contains focus and restores it after closing', () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    const view = render(<CommandPalette commands={commands()} onClose={() => undefined} />)
    const input = screen.getByRole('combobox', { name: 'Run a command' })
    const close = screen.getByRole('button', { name: 'Close command palette' })

    expect(document.activeElement).toBe(input)
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)

    view.unmount()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})
