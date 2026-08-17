import { describe, expect, it } from 'vitest'
import type { ProviderDraft } from '../shared/types.js'
import { defaultSamplerSettings } from '../shared/types.js'
import { open } from './db.js'
import {
  create,
  find,
  list,
  readSlots,
  remove,
  update,
  writeContext,
  writeDetectedContext,
  writeSampling,
  writeSlot,
} from './providers.js'

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

describe('writeDetectedContext', () => {
  function seeded(): ReturnType<typeof open> {
    const db = open(':memory:')
    writeSlot(db, 'fast', 'openai', 'gpt-oss-20b')
    writeSlot(db, 'expert', 'openai', 'gpt-oss-120b')
    return db
  }

  it('records the window for the model a slot is using', () => {
    const db = seeded()
    const slots = writeDetectedContext(db, 'openai', [{ id: 'gpt-oss-20b', contextLength: 131_072 }])

    expect(slots?.fast.detectedContextTokens).toBe(131_072)
    expect(slots?.expert.detectedContextTokens).toBeUndefined()
  })

  /** A refresh for one provider must not rewrite a slot pointing elsewhere. */
  it('leaves slots on other providers alone', () => {
    const db = seeded()
    db.prepare('INSERT INTO providers (id, name, base_url, api) VALUES (?, ?, ?, ?)')
      .run('other', 'Other', 'https://other.example/v1', 'responses')
    writeSlot(db, 'expert', 'other', 'gpt-oss-20b')
    writeDetectedContext(db, 'openai', [{ id: 'gpt-oss-20b', contextLength: 131_072 }])

    expect(readSlots(db).expert.detectedContextTokens).toBeUndefined()
  })

  it('ignores models the server reported no window for', () => {
    const db = seeded()
    expect(writeDetectedContext(db, 'openai', [{ id: 'gpt-oss-20b' }])).toBeUndefined()
  })

  /** An unchanged Refresh should not broadcast, so it reports nothing moved. */
  it('reports nothing when the window has not changed', () => {
    const db = seeded()
    const models = [{ id: 'gpt-oss-20b', contextLength: 131_072 }]
    expect(writeDetectedContext(db, 'openai', models)).toBeDefined()
    expect(writeDetectedContext(db, 'openai', models)).toBeUndefined()
  })

  it('updates when a server reports a different window than before', () => {
    const db = seeded()
    writeDetectedContext(db, 'openai', [{ id: 'gpt-oss-20b', contextLength: 131_072 }])
    const slots = writeDetectedContext(db, 'openai', [{ id: 'gpt-oss-20b', contextLength: 32_768 }])
    expect(slots?.fast.detectedContextTokens).toBe(32_768)
  })

  /** A typed override is separate storage, so discovery cannot overwrite it. */
  it('does not disturb a window the user typed', () => {
    const db = seeded()
    writeContext(db, 'fast', 8_192)
    writeDetectedContext(db, 'openai', [{ id: 'gpt-oss-20b', contextLength: 131_072 }])

    const slots = readSlots(db)
    expect(slots.fast.contextTokens).toBe(8_192)
    expect(slots.fast.detectedContextTokens).toBe(131_072)
  })
})
