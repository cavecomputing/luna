// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultPrefs, type Prefs } from '../../shared/prefs.js'
import { err, ok } from '../../shared/result.js'
import { usePrefs } from './use-prefs.js'

function bridge(reads: Prefs[]): { get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(() => Promise.resolve(ok(reads.shift() ?? defaultPrefs)))
  Object.defineProperty(window, 'luna', {
    configurable: true,
    value: {
      prefs: {
        get,
        set: () => Promise.resolve(err('prefs/write', 'write failed')),
      },
      onPrefs: () => () => undefined,
    },
  })
  return { get }
}

describe('usePrefs', () => {
  it('re-reads main after a failed write instead of restoring a stale value', async () => {
    const authoritative = { ...defaultPrefs, theme: 'luna-dark' } satisfies Prefs
    const { get } = bridge([defaultPrefs, authoritative])
    const { result } = renderHook(() => usePrefs())

    await waitFor(() => {
      expect(result.current.ready).toBe(true)
    })

    act(() => {
      result.current.set('defaultMode', 'expert')
    })
    expect(result.current.prefs.defaultMode).toBe('expert')

    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(2)
      expect(result.current.prefs).toEqual(authoritative)
    })
  })
})
