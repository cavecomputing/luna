// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useComposer } from './use-composer.js'

type Key = {
  key: string
  shiftKey?: boolean
  composing?: boolean
}

/** Minimal stand-in for the parts of the React keyboard event we read. */
const keyEvent = ({ key, shiftKey = false, composing = false }: Key) => {
  const preventDefault = vi.fn()
  const event = {
    key,
    shiftKey,
    preventDefault,
    nativeEvent: { isComposing: composing },
  } as unknown as Parameters<ReturnType<typeof useComposer>['onKeyDown']>[0]
  return { event, preventDefault }
}

describe('useComposer', () => {
  it('starts empty and cannot send', () => {
    const { result } = renderHook(() => useComposer(vi.fn()))
    expect(result.current.draft).toBe('')
    expect(result.current.canSend).toBe(false)
  })

  it('cannot send whitespace only', () => {
    const { result } = renderHook(() => useComposer(vi.fn()))
    act(() => {
      result.current.setDraft('   ')
    })
    expect(result.current.canSend).toBe(false)
  })

  it('sends trimmed text and clears the draft', () => {
    const onSend = vi.fn()
    const { result } = renderHook(() => useComposer(onSend))

    act(() => {
      result.current.setDraft('  hello  ')
    })
    act(() => {
      result.current.submit()
    })

    expect(onSend).toHaveBeenCalledWith('hello')
    expect(result.current.draft).toBe('')
  })

  it('does nothing when submitting an empty draft', () => {
    const onSend = vi.fn()
    const { result } = renderHook(() => useComposer(onSend))
    act(() => {
      result.current.submit()
    })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends on Enter', () => {
    const onSend = vi.fn()
    const { result } = renderHook(() => useComposer(onSend))
    act(() => {
      result.current.setDraft('hi')
    })

    const { event, preventDefault } = keyEvent({ key: 'Enter' })
    act(() => {
      result.current.onKeyDown(event)
    })

    expect(onSend).toHaveBeenCalledWith('hi')
    expect(preventDefault).toHaveBeenCalled()
  })

  it('adds a newline on Shift+Enter instead of sending', () => {
    const onSend = vi.fn()
    const { result } = renderHook(() => useComposer(onSend))
    act(() => {
      result.current.setDraft('hi')
    })

    const { event, preventDefault } = keyEvent({ key: 'Enter', shiftKey: true })
    act(() => {
      result.current.onKeyDown(event)
    })

    expect(onSend).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('ignores Enter while an IME is composing', () => {
    const onSend = vi.fn()
    const { result } = renderHook(() => useComposer(onSend))
    act(() => {
      result.current.setDraft('こんにちは')
    })

    const { event, preventDefault } = keyEvent({ key: 'Enter', composing: true })
    act(() => {
      result.current.onKeyDown(event)
    })

    expect(onSend).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('leaves other keys alone', () => {
    const onSend = vi.fn()
    const { result } = renderHook(() => useComposer(onSend))
    act(() => {
      result.current.setDraft('hi')
    })

    const { event } = keyEvent({ key: 'a' })
    act(() => {
      result.current.onKeyDown(event)
    })

    expect(onSend).not.toHaveBeenCalled()
  })
})
