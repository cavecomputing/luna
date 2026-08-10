import { describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from './providers.js'
import { discoverModels, parseModels } from './openai.js'

const provider: ProviderConfig = {
  id: 'example',
  name: 'Example AI',
  baseUrl: 'https://api.example.com/v1',
  api: 'responses',
  organization: 'org-example',
  project: 'proj-example',
}

describe('parseModels', () => {
  it('parses, deduplicates, and sorts the OpenAI model list shape', () => {
    const result = parseModels({
      object: 'list',
      data: [
        { id: 'z-model', owned_by: 'example', created: 2 },
        { id: 'A-model', owned_by: 'example', created: 1 },
        { id: 'z-model' },
        { missing: 'id' },
      ],
    })

    expect(result).toEqual({
      ok: true,
      value: [{ id: 'A-model', ownedBy: 'example', created: 1 }, { id: 'z-model' }],
    })
  })

  it('rejects a response without the required data array', () => {
    expect(parseModels({ object: 'list' })).toMatchObject({
      ok: false,
      code: 'provider/bad-response',
    })
  })
})

describe('discoverModels', () => {
  it('calls GET /models with bearer, organization, and project headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'model-1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await discoverModels(provider, 'test-secret', fetcher)

    expect(result).toEqual({ ok: true, value: [{ id: 'model-1' }] })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer test-secret',
          'OpenAI-Organization': 'org-example',
          'OpenAI-Project': 'proj-example',
        },
      }),
    )
  })

  it('supports a local provider with no API key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    )

    await discoverModels({ ...provider, organization: '', project: '' }, undefined, fetcher)

    const init = fetcher.mock.calls[0]?.[1]
    expect(init?.headers).toEqual({ Accept: 'application/json' })
  })

  it.each([
    [401, 'provider/auth'],
    [403, 'provider/auth'],
    [404, 'provider/not-found'],
    [429, 'provider/rate-limit'],
    [500, 'provider/http'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }))
    const result = await discoverModels(provider, undefined, fetcher)
    expect(result).toMatchObject({ ok: false, code })
  })

  it('maps a failed request to provider/network', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    const result = await discoverModels(provider, undefined, fetcher)
    expect(result).toMatchObject({ ok: false, code: 'provider/network' })
  })

  it('rejects a successful response that is not JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json'))
    const result = await discoverModels(provider, undefined, fetcher)
    expect(result).toMatchObject({ ok: false, code: 'provider/bad-response' })
  })
})
