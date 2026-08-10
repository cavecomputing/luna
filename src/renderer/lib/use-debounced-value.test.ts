// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './use-debounced-value.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedValue', () => {
  it('publishes the latest value only after the delay', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 150),
      { initialProps: { value: 'coast' } },
    )

    rerender({ value: 'dinner' })
    expect(result.current).toBe('coast')

    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(result.current).toBe('coast')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('dinner')
  })
})
