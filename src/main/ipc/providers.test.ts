import { describe, expect, it, vi } from 'vitest'
import type { ModelSlots, Mode, ProviderDraft, SamplerSettings } from '../../shared/types.js'
import { defaultSamplerSettings } from '../../shared/types.js'
import type { ProviderConfig } from '../providers.js'
import {
  cleanDraft,
  cleanSampling,
  createProvider,
  deleteProvider,
  getModels,
  getSlots,
  listProviders,
  setKey,
  updateProvider,
  updateSampling,
  updateSlot,
} from './providers.js'

const draft: ProviderDraft = {
  name: 'Example AI',
  baseUrl: 'https://api.example.com/v1',
  api: 'responses',
  organization: '',
  project: '',
}

const config: ProviderConfig = { id: 'example', ...draft }
const initialSlots: ModelSlots = {
  fast: { providerId: 'example', model: 'model-small', sampling: { ...defaultSamplerSettings } },
  expert: { providerId: 'example', model: 'model-large', sampling: { ...defaultSamplerSettings } },
}

type TestDeps = Parameters<typeof createProvider>[1]

function makeDeps(): TestDeps {
  let items = [config]
  let slots = initialSlots
  return {
    list: vi.fn(() => items),
    get: vi.fn((id: string) => items.find((provider) => provider.id === id)),
    add: vi.fn((id: string, provider: ProviderDraft) => {
      const value = { id, ...provider }
      items = [...items, value]
      return value
    }),
    save: vi.fn((id: string, provider: ProviderDraft) => {
      if (!items.some((value) => value.id === id)) return undefined
      const value = { id, ...provider }
      items = items.map((item) => (item.id === id ? value : item))
      return value
    }),
    drop: vi.fn((id: string) => {
      const before = items.length
      items = items.filter((provider) => provider.id !== id)
      slots = {
        fast: {
          ...slots.fast,
          providerId: slots.fast.providerId === id ? null : slots.fast.providerId,
        },
        expert: {
          ...slots.expert,
          providerId: slots.expert.providerId === id ? null : slots.expert.providerId,
        },
      }
      return before !== items.length
    }),
    slots: vi.fn(() => slots),
    setSlot: vi.fn((slot: Mode, providerId: string | null, model: string) => {
      slots = { ...slots, [slot]: { ...slots[slot], providerId, model } }
      return slots
    }),
    setSampling: vi.fn((slot: Mode, sampling: SamplerSettings) => {
      slots = { ...slots, [slot]: { ...slots[slot], sampling } }
      return slots
    }),
    hasKey: vi.fn(() => Promise.resolve(false)),
    readKey: vi.fn(() => Promise.resolve(undefined)),
    writeKey: vi.fn(() => Promise.resolve()),
    clearKey: vi.fn(() => Promise.resolve()),
    discover: vi.fn(() => Promise.resolve({ ok: true as const, value: [{ id: 'model-1' }] })),
    newId: vi.fn(() => 'new-provider'),
    notifyProviders: vi.fn(),
    notifyModels: vi.fn(),
  }
}

describe('cleanDraft', () => {
  it('normalizes whitespace and a trailing slash', () => {
    expect(
      cleanDraft({ ...draft, name: ' Example AI ', baseUrl: 'https://api.example.com/v1/' }),
    ).toEqual({ ok: true, value: draft })
  })

  it.each([
    undefined,
    { ...draft, name: '' },
    { ...draft, baseUrl: 'file:///private' },
    { ...draft, baseUrl: 'https://user:pass@api.example.com/v1' },
    { ...draft, api: 'legacy' },
  ])('returns provider/invalid for invalid provider input', (input) => {
    expect(cleanDraft(input)).toMatchObject({ ok: false, code: 'provider/invalid' })
  })

  it('accepts HTTP for local OpenAI-compatible servers', () => {
    expect(cleanDraft({ ...draft, baseUrl: 'http://localhost:11434/v1' }).ok).toBe(true)
  })
})

describe('provider IPC actions', () => {
  it('lists providers with only a credential-presence flag', async () => {
    const d = makeDeps()
    d.hasKey = vi.fn(() => Promise.resolve(true))
    expect(await listProviders(d)).toEqual({
      ok: true,
      value: [{ ...config, hasApiKey: true }],
    })
  })

  it('creates and broadcasts a provider', async () => {
    const d = makeDeps()
    const result = await createProvider(draft, d)
    expect(result).toEqual({
      ok: true,
      value: { id: 'new-provider', ...draft, hasApiKey: false },
    })
    expect(d.notifyProviders).toHaveBeenCalledTimes(1)
  })

  it('returns provider/invalid when create input is malformed', async () => {
    expect(await createProvider(undefined, makeDeps())).toMatchObject({
      ok: false,
      code: 'provider/invalid',
    })
  })

  it('updates and broadcasts an existing provider', async () => {
    const d = makeDeps()
    const result = await updateProvider(
      { id: 'example', provider: { ...draft, api: 'chat-completions' } },
      d,
    )
    expect(result).toMatchObject({ ok: true, value: { api: 'chat-completions' } })
    expect(d.notifyProviders).toHaveBeenCalledTimes(1)
  })

  it('returns provider/missing when update targets an unknown provider', async () => {
    expect(
      await updateProvider({ id: 'missing', provider: draft }, makeDeps()),
    ).toMatchObject({ ok: false, code: 'provider/missing' })
  })

  it('returns provider/invalid when update input is malformed', async () => {
    expect(await updateProvider({ id: '../bad', provider: draft }, makeDeps())).toMatchObject({
      ok: false,
      code: 'provider/invalid',
    })
  })

  it('writes a key once and returns only hasApiKey', async () => {
    const d = makeDeps()
    d.hasKey = vi.fn(() => Promise.resolve(true))
    const result = await setKey({ id: 'example', apiKey: 'test-secret' }, d)
    expect(d.writeKey).toHaveBeenCalledWith('example', 'test-secret')
    expect(result).toMatchObject({ ok: true, value: { hasApiKey: true } })
    expect(JSON.stringify(result)).not.toContain('test-secret')
  })

  it('clears a stored key', async () => {
    const d = makeDeps()
    expect(await setKey({ id: 'example', apiKey: null }, d)).toMatchObject({ ok: true })
    expect(d.clearKey).toHaveBeenCalledWith('example')
  })

  it.each([
    [{ id: '../bad', apiKey: 'test-secret' }, 'provider/invalid'],
    [{ id: 'example', apiKey: '' }, 'provider/invalid'],
    [{ id: 'missing', apiKey: 'test-secret' }, 'provider/missing'],
  ])('returns %s for invalid key updates', async (input, code) => {
    expect(await setKey(input, makeDeps())).toMatchObject({ ok: false, code })
  })

  it('returns secret/unavailable when encrypted storage fails', async () => {
    const d = makeDeps()
    d.writeKey = vi.fn(() => Promise.reject(new Error('unavailable')))
    expect(await setKey({ id: 'example', apiKey: 'test-secret' }, d)).toMatchObject({
      ok: false,
      code: 'secret/unavailable',
    })
  })

  it('deletes a provider and broadcasts cleared model references', async () => {
    const d = makeDeps()
    expect(await deleteProvider({ id: 'example' }, d)).toEqual({ ok: true, value: undefined })
    expect(d.clearKey).toHaveBeenCalledWith('example')
    expect(d.notifyProviders).toHaveBeenCalledTimes(1)
    expect(d.notifyModels).toHaveBeenCalledWith({
      fast: { providerId: null, model: 'model-small', sampling: defaultSamplerSettings },
      expert: { providerId: null, model: 'model-large', sampling: defaultSamplerSettings },
    })
  })

  it('returns provider/missing when deleting an unknown provider', async () => {
    expect(await deleteProvider({ id: 'missing' }, makeDeps())).toMatchObject({
      ok: false,
      code: 'provider/missing',
    })
  })

  it('returns provider/invalid when delete input is malformed', async () => {
    expect(await deleteProvider(undefined, makeDeps())).toMatchObject({
      ok: false,
      code: 'provider/invalid',
    })
  })

  it('returns secret/unavailable when credential removal fails', async () => {
    const d = makeDeps()
    d.clearKey = vi.fn(() => Promise.reject(new Error('unavailable')))
    expect(await deleteProvider({ id: 'example' }, d)).toMatchObject({
      ok: false,
      code: 'secret/unavailable',
    })
  })
})

describe('model IPC actions', () => {
  it('discovers models with the main-only credential', async () => {
    const d = makeDeps()
    d.readKey = vi.fn(() => Promise.resolve('test-secret'))
    expect(await getModels({ id: 'example' }, d)).toEqual({
      ok: true,
      value: [{ id: 'model-1' }],
    })
    expect(d.discover).toHaveBeenCalledWith(config, 'test-secret')
  })

  it.each([
    [undefined, 'provider/invalid'],
    [{ id: 'missing' }, 'provider/missing'],
  ])('maps invalid model discovery input to %s', async (input, code) => {
    expect(await getModels(input, makeDeps())).toMatchObject({ ok: false, code })
  })

  it('returns secret/unavailable when the credential cannot be decrypted', async () => {
    const d = makeDeps()
    d.readKey = vi.fn(() => Promise.reject(new Error('unavailable')))
    expect(await getModels({ id: 'example' }, d)).toMatchObject({
      ok: false,
      code: 'secret/unavailable',
    })
  })

  it('passes provider errors through unchanged', async () => {
    const d = makeDeps()
    d.discover = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        code: 'provider/auth',
        message: 'credential rejected',
      }),
    )
    expect(await getModels({ id: 'example' }, d)).toMatchObject({
      ok: false,
      code: 'provider/auth',
    })
  })

  it('reads both model slots', () => {
    expect(getSlots(makeDeps())).toEqual({ ok: true, value: initialSlots })
  })

  it('updates one slot and broadcasts the stored set', () => {
    const d = makeDeps()
    const result = updateSlot(
      { slot: 'fast', providerId: 'example', model: ' custom-model ' },
      d,
    )
    expect(result).toMatchObject({
      ok: true,
      value: { fast: { providerId: 'example', model: 'custom-model' } },
    })
    expect(d.notifyModels).toHaveBeenCalledTimes(1)
  })

  it('validates, stores, and broadcasts sampler settings', () => {
    const d = makeDeps()
    const sampling = { ...defaultSamplerSettings, enabled: true, temperature: 0.5, topK: 40 }

    expect(updateSampling({ slot: 'fast', sampling }, d)).toMatchObject({
      ok: true,
      value: { fast: { sampling } },
    })
    expect(d.setSampling).toHaveBeenCalledWith('fast', sampling)
    expect(d.notifyModels).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed or out-of-range sampler settings', () => {
    expect(cleanSampling({ ...defaultSamplerSettings, temperature: 3 })).toMatchObject({
      ok: false,
      code: 'model/invalid',
    })
    expect(
      updateSampling({ slot: 'fast', sampling: { ...defaultSamplerSettings, seed: 1.5 } }, makeDeps()),
    ).toMatchObject({ ok: false, code: 'model/invalid' })
  })

  it.each([
    [undefined],
    [{ slot: 'turbo', providerId: 'example', model: 'model-1' }],
    [{ slot: 'fast', providerId: 'missing', model: 'model-1' }],
    [{ slot: 'fast', providerId: 'example', model: 42 }],
  ])('returns model/invalid for malformed assignments', (input) => {
    expect(updateSlot(input, makeDeps())).toMatchObject({ ok: false, code: 'model/invalid' })
  })
})
