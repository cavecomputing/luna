// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSlots, Provider } from '../../../../shared/types.js'
import { Models, mergeDrafts } from './models.js'

const provider: Provider = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  api: 'responses',
  organization: '',
  project: '',
  hasApiKey: true,
}

function slots(fast: string, expert: string): ModelSlots {
  return {
    fast: { providerId: 'openai', model: fast },
    expert: { providerId: 'openai', model: expert },
  }
}

afterEach(() => {
  cleanup()
})

describe('mergeDrafts', () => {
  it('keeps local drafts when the broadcast carries what this window saved', () => {
    // The user paused typing, the debounce saved 'gpt-4', and they kept
    // typing 'gpt-4o-mini'. The round trip must not snap the field back.
    const merged = mergeDrafts(
      { fast: 'gpt-4o-mini', expert: '' },
      slots('gpt-4', ''),
      slots('gpt-4', ''),
    )
    expect(merged.fast).toBe('gpt-4o-mini')
    expect(merged.expert).toBe('')
  })

  it('adopts a broadcast value that came from somewhere else', () => {
    const merged = mergeDrafts(
      { fast: 'gpt-4', expert: '' },
      slots('gpt-4', 'claude-sonnet'),
      slots('gpt-4', ''),
    )
    expect(merged.expert).toBe('claude-sonnet')
  })

  it('treats the two slots independently', () => {
    const merged = mergeDrafts(
      { fast: 'typing…', expert: 'local' },
      slots('saved-fast', 'saved-expert'),
      slots('saved-fast', 'other'),
    )
    expect(merged.fast).toBe('typing…')
    expect(merged.expert).toBe('saved-expert')
  })

  it('adopts a provider change even when its model text matches the last save', () => {
    const incoming = slots('same-model', '')
    incoming.fast.providerId = 'local'

    const merged = mergeDrafts(
      { fast: 'still typing', expert: '' },
      incoming,
      slots('same-model', ''),
    )
    expect(merged.fast).toBe('same-model')
  })
})

describe('Models', () => {
  it('does not save the empty initial drafts over persisted model choices', async () => {
    const persisted = slots('gpt-fast', 'gpt-expert')
    const set = vi.fn(() => Promise.resolve({ ok: true as const, value: persisted }))

    Object.defineProperty(window, 'luna', {
      configurable: true,
      value: {
        providers: {
          list: () => Promise.resolve({ ok: true, value: [provider] }),
          models: () => Promise.resolve({ ok: true, value: [] }),
        },
        models: {
          get: () => Promise.resolve({ ok: true, value: persisted }),
          set,
        },
        onProviders: () => () => undefined,
        onModels: () => () => undefined,
      },
    })

    render(<Models />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('gpt-expert')).toBeTruthy()
    })
    expect(set).not.toHaveBeenCalled()
  })
})
