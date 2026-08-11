// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Result } from '../../../shared/result.js'
import { CrashApp } from './crash-app.js'

type Action = () => Promise<Result<undefined>>

function bridge(
  recover: Action = () => Promise.resolve({ ok: true, value: undefined }),
  closeWindow: Action = () => Promise.resolve({ ok: true, value: undefined }),
): void {
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: { app: { recover, closeWindow } },
  })
}

afterEach(cleanup)

describe('CrashApp', () => {
  it('requests recovery', async () => {
    const recover = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
    bridge(recover)
    render(<CrashApp />)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(recover).toHaveBeenCalledOnce()
    })
  })

  it('can close only its recovery window', async () => {
    const closeWindow = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
    bridge(undefined, closeWindow)
    render(<CrashApp />)

    fireEvent.click(screen.getByRole('button', { name: 'Close window' }))
    await waitFor(() => {
      expect(closeWindow).toHaveBeenCalledOnce()
    })
  })

  it('shows a useful fallback when recovery is rejected', async () => {
    bridge(vi.fn(() => Promise.resolve({
      ok: false as const,
      code: 'app/not-recovering',
      message: 'test-rejected',
    })))
    render(<CrashApp />)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Luna couldn’t recover this window.',
    )
  })
})
