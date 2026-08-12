// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import dialogStyles from '../../ui/dialog.module.css'
import { CommandPalette } from './command-palette.js'

afterEach(cleanup)

describe('CommandPalette', () => {
  it('shows its WIP state and closes from its button', () => {
    const close = vi.fn()
    render(<CommandPalette onClose={close} />)

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy()
    expect(screen.getByText('Commands are coming soon.')).toBeTruthy()
    const closeButton = screen.getByRole('button', { name: 'Close command palette' })
    expect(closeButton.textContent).toBe('Esc')
    fireEvent.click(closeButton)
    expect(close).toHaveBeenCalledOnce()
  })

  it('opens in the center of the window', () => {
    render(<CommandPalette onClose={() => undefined} />)

    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    const center = dialogStyles.center
    if (center === undefined) throw new Error('Missing center dialog style')
    expect(dialog.parentElement?.classList.contains(center)).toBe(true)
  })

  it('contains focus and restores it after closing', () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    const view = render(<CommandPalette onClose={() => undefined} />)
    const input = screen.getByRole('textbox', { name: 'Command' })
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
