import { describe, expect, it } from 'vitest'
import { mergeDrafts } from './models.js'
import type { ModelSlots } from '../../../../shared/types.js'

function slots(fast: string, expert: string): ModelSlots {
  return {
    fast: { providerId: 'openai', model: fast },
    expert: { providerId: 'openai', model: expert },
  }
}

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
