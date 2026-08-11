// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ModelSlots } from '../../../shared/types.js'
import { ok } from '../../../shared/result.js'
import { useModels } from './use-models.js'

const initial: ModelSlots = {
  fast: { providerId: 'provider-1', model: 'fast-model' },
  expert: { providerId: 'provider-1', model: 'expert-model' },
}

describe('useModels', () => {
  it('loads model slots and follows live model changes', async () => {
    let notify: ((slots: ModelSlots) => void) | undefined
    Object.defineProperty(window, 'luna', {
      configurable: true,
      value: {
        models: { get: () => Promise.resolve(ok(initial)) },
        onModels: (listener: (slots: ModelSlots) => void) => {
          notify = listener
          return () => undefined
        },
      },
    })
    const { result } = renderHook(() => useModels())

    await waitFor(() => {
      expect(result.current.fast.model).toBe('fast-model')
    })

    act(() => {
      notify?.({ ...initial, fast: { providerId: 'provider-2', model: 'new-fast' } })
    })
    expect(result.current.fast.model).toBe('new-fast')
  })
})
