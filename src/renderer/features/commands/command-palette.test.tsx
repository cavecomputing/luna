// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './command-palette.js'

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
})
