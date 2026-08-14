import { describe, expect, it } from 'vitest'
import type { ProviderDraft } from '../shared/types.js'
import { defaultSamplerSettings } from '../shared/types.js'
import { open } from './db.js'
import { create, find, list, readSlots, remove, update, writeSampling, writeSlot } from './providers.js'

const draft: ProviderDraft = {
  name: 'Example AI',
  baseUrl: 'https://api.example.com/v1',
  api: 'responses',
  organization: 'org-example',
  project: 'proj-example',
}

describe('provider storage', () => {
  it('stores and lists non-secret provider configuration', () => {
    const db = open(':memory:')
    create(db, 'example', draft)

    expect(find(db, 'example')).toEqual({ id: 'example', ...draft })
    expect(list(db)).toContainEqual({ id: 'example', ...draft })
  })

  it('updates an existing provider and reports a missing one', () => {
    const db = open(':memory:')
    create(db, 'example', draft)

    expect(update(db, 'example', { ...draft, api: 'chat-completions' })?.api).toBe(
      'chat-completions',
    )
    expect(update(db, 'missing', draft)).toBeUndefined()
  })

  it('deletes a provider and clears model slot references', () => {
    const db = open(':memory:')
    create(db, 'example', draft)
    writeSlot(db, 'fast', 'example', 'model-small')

    expect(remove(db, 'example')).toBe(true)
    expect(readSlots(db).fast).toEqual({
      providerId: null,
      model: 'model-small',
      sampling: defaultSamplerSettings,
    })
  })
})

describe('model slot storage', () => {
  it('stores Fast and Expert independently', () => {
    const db = open(':memory:')
    create(db, 'example', draft)

    writeSlot(db, 'fast', 'example', 'model-small')
    const slots = writeSlot(db, 'expert', 'openai', 'model-large')

    expect(slots).toEqual({
      fast: { providerId: 'example', model: 'model-small', sampling: defaultSamplerSettings },
      expert: { providerId: 'openai', model: 'model-large', sampling: defaultSamplerSettings },
    })
  })

  it('rejects a provider id that is not in the providers table', () => {
    const db = open(':memory:')
    expect(() => writeSlot(db, 'fast', 'missing', 'model-small')).toThrow()
  })

  it('stores sampler overrides independently for one slot', () => {
    const db = open(':memory:')
    const sampling = {
      ...defaultSamplerSettings,
      enabled: true,
      temperature: 0.4,
      topK: 40,
    }

    const slots = writeSampling(db, 'expert', sampling)

    expect(slots.expert.sampling).toEqual(sampling)
    expect(slots.fast.sampling).toEqual(defaultSamplerSettings)
  })
})
