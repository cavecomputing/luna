// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { ErrorBoundary } from './error-boundary.js'

let consoleError: MockInstance

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  consoleError.mockRestore()
})

describe('ErrorBoundary', () => {
  it('renders a healthy child normally', () => {
    render(
      <ErrorBoundary>
        <p>Healthy interface</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('Healthy interface')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('replaces a rendering failure without exposing its error', () => {
    function Broken(): React.JSX.Element {
      throw new Error('private synthetic detail')
    }

    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: 'Luna ran into a display problem.' })).toBeTruthy()
    expect(screen.queryByText(/private synthetic detail/)).toBeNull()
  })

  it('remounts the child when the user tries again', () => {
    let failing = true
    function Recoverable(): React.JSX.Element {
      if (failing) throw new Error('synthetic failure')
      return <p>Interface restored</p>
    }

    render(
      <ErrorBoundary>
        <Recoverable />
      </ErrorBoundary>,
    )
    failing = false

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Interface restored')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reloads the window when requested', () => {
    const reload = vi.fn()
    function Broken(): React.JSX.Element {
      throw new Error('synthetic failure')
    }
    render(
      <ErrorBoundary reload={reload}>
        <Broken />
      </ErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reload window' }))

    expect(reload).toHaveBeenCalledOnce()
  })

  it('focuses the primary recovery action', () => {
    function Broken(): React.JSX.Element {
      throw new Error('synthetic failure')
    }
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    )

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }))
  })
})
