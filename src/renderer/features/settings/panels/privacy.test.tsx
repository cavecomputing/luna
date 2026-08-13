// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Privacy } from './privacy.js'

type BridgeOptions = {
  exportAll?: ReturnType<typeof vi.fn>
  deleteAll?: ReturnType<typeof vi.fn>
  storage?: ReturnType<typeof vi.fn>
  clearUnsent?: ReturnType<typeof vi.fn>
}

function bridge({
  exportAll = vi.fn(() => Promise.resolve({ ok: true as const, value: { written: 3 } })),
  deleteAll = vi.fn(() => Promise.resolve({ ok: true as const, value: { deleted: true } })),
  storage = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: {
      totalBytes: 1_572_864,
      totalCount: 3,
      sentBytes: 1_048_576,
      sentCount: 2,
      unsentBytes: 524_288,
      unsentCount: 1,
    },
  })),
  clearUnsent = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { removedBytes: 524_288, removedCount: 1 },
  })),
}: BridgeOptions = {}): void {
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: {
      privacy: { exportAll, deleteAll },
      attachments: { storage, clearUnsent },
      onAttachmentStorage: () => () => undefined,
    },
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
  it('shows total, sent, and unsent attachment storage', async () => {
    bridge()
    render(<Privacy />)

    await waitFor(() => {
      expect(screen.getByText(/1.5 MiB/)).toBeTruthy()
    })
    expect(screen.getByText(/1.0 MiB sent · 512.0 KiB unsent/)).toBeTruthy()
  })

  it('removes unsent attachments while describing the preserved scope', async () => {
    const clearUnsent = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { removedBytes: 524_288, removedCount: 1 },
    }))
    bridge({ clearUnsent })
    render(<Privacy />)
    const button = await screen.findByRole('button', { name: /Remove unsent attachments/ })

    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Removed 1 unsent attachment (512.0 KiB).')).toBeTruthy()
    })
    expect(clearUnsent).toHaveBeenCalledOnce()
    expect(screen.getByText(/already sent in messages are kept/)).toBeTruthy()
  })

  it('disables unsent cleanup when no unsent files exist', async () => {
    bridge({
      storage: vi.fn(() => Promise.resolve({
        ok: true as const,
        value: {
          totalBytes: 10,
          totalCount: 1,
          sentBytes: 10,
          sentCount: 1,
          unsentBytes: 0,
          unsentCount: 0,
        },
      })),
    })
    render(<Privacy />)

    const button: HTMLButtonElement = await screen.findByRole('button', {
      name: /Remove unsent attachments/,
    })
    await waitFor(() => {
      expect(button.disabled).toBe(true)
    })
  })

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
