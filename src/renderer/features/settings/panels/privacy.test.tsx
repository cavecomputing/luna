// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Privacy } from './privacy.js'

type BridgeOptions = {
  exportAll?: ReturnType<typeof vi.fn>
  deleteAll?: ReturnType<typeof vi.fn>
}

function bridge({
  exportAll = vi.fn(() => Promise.resolve({ ok: true as const, value: { written: 3 } })),
  deleteAll = vi.fn(() => Promise.resolve({ ok: true as const, value: { deleted: true } })),
}: BridgeOptions = {}): void {
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: { privacy: { exportAll, deleteAll } },
  })
}

function deleteButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Delete All Data/ })
}

function confirmField(): HTMLInputElement {
  return screen.getByLabelText(/Type DELETE to confirm/)
}

afterEach(() => {
  cleanup()
})

describe('Privacy panel', () => {
  it('keeps delete disabled until the confirmation word is typed exactly', () => {
    bridge()
    render(<Privacy />)

    expect(deleteButton().disabled).toBe(true)

    fireEvent.change(confirmField(), { target: { value: 'delete' } })
    expect(deleteButton().disabled).toBe(true)

    fireEvent.change(confirmField(), { target: { value: 'DELETE' } })
    expect(deleteButton().disabled).toBe(false)
  })

  it('does not reach the bridge while the confirmation is incomplete', () => {
    const deleteAllSpy = vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { deleted: true } }),
    )
    bridge({ deleteAll: deleteAllSpy })
    render(<Privacy />)

    fireEvent.click(deleteButton())

    expect(deleteAllSpy).not.toHaveBeenCalled()
  })

  it('reports a completed delete and clears the confirmation', async () => {
    bridge()
    render(<Privacy />)
    fireEvent.change(confirmField(), { target: { value: 'DELETE' } })

    fireEvent.click(deleteButton())

    await waitFor(() => {
      expect(screen.getByText('Luna is back to a clean install.')).toBeTruthy()
    })
    expect(confirmField().value).toBe('')
    expect(deleteButton().disabled).toBe(true)
  })

  it('says nothing when the native confirmation was cancelled', async () => {
    bridge({
      deleteAll: vi.fn(() => Promise.resolve({ ok: true as const, value: { deleted: false } })),
    })
    render(<Privacy />)
    fireEvent.change(confirmField(), { target: { value: 'DELETE' } })

    fireEvent.click(deleteButton())

    await waitFor(() => {
      expect(confirmField().value).toBe('')
    })
    expect(screen.queryByText('Luna is back to a clean install.')).toBeNull()
  })

  it('explains the half-state when a delete partly fails', async () => {
    bridge({
      deleteAll: vi.fn(() =>
        Promise.resolve({ ok: false as const, code: 'privacy/failed', message: 'test' }),
      ),
    })
    render(<Privacy />)
    fireEvent.change(confirmField(), { target: { value: 'DELETE' } })

    fireEvent.click(deleteButton())

    await waitFor(() => {
      expect(screen.getByText(/API keys were deleted/)).toBeTruthy()
    })
  })

  it('reports how many conversations were exported', async () => {
    bridge()
    render(<Privacy />)

    fireEvent.click(screen.getByRole('button', { name: /Export all conversations/ }))

    await waitFor(() => {
      expect(screen.getByText('Exported 3 conversations.')).toBeTruthy()
    })
  })

  it('stays quiet when the export destination was not chosen', async () => {
    bridge({
      exportAll: vi.fn(() => Promise.resolve({ ok: true as const, value: { written: 0 } })),
    })
    render(<Privacy />)

    fireEvent.click(screen.getByRole('button', { name: /Export all conversations/ }))

    await waitFor(() => {
      expect(screen.queryByText(/Exporting/)).toBeNull()
    })
    expect(screen.queryByText(/Exported/)).toBeNull()
  })

  it('reports a failed export', async () => {
    bridge({
      exportAll: vi.fn(() =>
        Promise.resolve({ ok: false as const, code: 'privacy/export', message: 'test' }),
      ),
    })
    render(<Privacy />)

    fireEvent.click(screen.getByRole('button', { name: /Export all conversations/ }))

    await waitFor(() => {
      expect(screen.getByText(/could not be completed/)).toBeTruthy()
    })
  })
})
