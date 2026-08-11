// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseRecoveryStatus } from '../../../shared/ipc.js'
import type { Result } from '../../../shared/result.js'
import { DatabaseRecoveryApp } from './database-recovery-app.js'

type Action = () => Promise<Result<undefined>>

function bridge(status: DatabaseRecoveryStatus, actions: Partial<Record<string, Action>> = {}): void {
  const ok = (): Promise<Result<undefined>> => Promise.resolve({ ok: true, value: undefined })
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: {
      recovery: {
        status: () => Promise.resolve({ ok: true, value: status }),
        restore: actions.restore ?? ok,
        retry: actions.retry ?? ok,
        startFresh: actions.startFresh ?? ok,
        quit: actions.quit ?? ok,
      },
    },
  })
}

afterEach(cleanup)

describe('DatabaseRecoveryApp', () => {
  it('offers a dated valid backup without exposing a path', async () => {
    const restore = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
    bridge({ kind: 'corrupt', backupCreatedAt: new Date(2026, 0, 2, 12).getTime() }, { restore })
    render(<DatabaseRecoveryApp />)

    expect((await screen.findByRole('heading')).textContent).toContain('damaged')
    expect(screen.getByText(/valid backup/i).textContent).not.toContain('luna.db')
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }))
    await waitFor(() => {
      expect(restore).toHaveBeenCalledOnce()
    })
  })

  it('requires a second confirmation before starting fresh', async () => {
    const startFresh = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
    bridge({ kind: 'corrupt-empty' }, { startFresh })
    render(<DatabaseRecoveryApp />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start fresh' }))
    expect(startFresh).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Go back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create empty database' }))
    await waitFor(() => {
      expect(startFresh).toHaveBeenCalledOnce()
    })
  })

  it('offers retry but not destructive recovery after a migration failure', async () => {
    bridge({ kind: 'migration-failed' })
    render(<DatabaseRecoveryApp />)

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /fresh/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull()
  })

  it('only permits quitting when the schema belongs to a newer Luna', async () => {
    bridge({ kind: 'newer-version' })
    render(<DatabaseRecoveryApp />)

    expect((await screen.findByRole('heading')).textContent).toContain('newer version')
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Quit Luna'])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Quit Luna' }))
  })

  it('shows a privacy-safe fallback when an action fails', async () => {
    bridge({ kind: 'migration-failed' }, {
      retry: () => Promise.resolve({ ok: false, code: 'recovery/retry-failed', message: 'test' }),
    })
    render(<DatabaseRecoveryApp />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect((await screen.findByRole('alert')).textContent).toContain('was not discarded')
  })
})
