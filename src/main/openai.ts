import { err, ok, type Result } from '../shared/result.js'
import type { ProviderModel } from '../shared/types.js'
import { object } from './parse.js'
import type { ProviderConfig } from './providers.js'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

function model(row: unknown): ProviderModel | undefined {
  const cell = object(row)
  if (cell === undefined || typeof cell.id !== 'string' || cell.id.trim() === '') return undefined

  const value: ProviderModel = { id: cell.id }
  if (typeof cell.owned_by === 'string') value.ownedBy = cell.owned_by
  if (typeof cell.created === 'number' && Number.isFinite(cell.created)) {
    value.created = cell.created
  }
  return value
}

export function parseModels(input: unknown): Result<ProviderModel[]> {
  const root = object(input)
  if (root === undefined) {
    return err('provider/bad-response', 'model list was not an object')
  }
  if (!Array.isArray(root.data)) {
    return err('provider/bad-response', 'model list had no data array')
  }

  const found = new Map<string, ProviderModel>()
  for (const row of root.data) {
    const parsed = model(row)
    if (parsed !== undefined) found.set(parsed.id, parsed)
  }

  return ok(
    [...found.values()].sort((left, right) =>
      left.id.localeCompare(right.id, undefined, { sensitivity: 'base' }),
    ),
  )
}

function statusError(status: number): Result<never> {
  if (status === 401 || status === 403) {
    return err('provider/auth', 'provider rejected the credential')
  }
  if (status === 404) return err('provider/not-found', 'provider has no models endpoint')
  if (status === 429) return err('provider/rate-limit', 'provider rate limit reached')
  return err('provider/http', `provider returned HTTP ${String(status)}`)
}

/** Headers every OpenAI-compatible request carries, keyed by provider config. */
export function providerHeaders(
  provider: ProviderConfig,
  apiKey: string | undefined,
  accept: string,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept }
  if (apiKey !== undefined && apiKey !== '') headers.Authorization = `Bearer ${apiKey}`
  if (provider.organization !== '') headers['OpenAI-Organization'] = provider.organization
  if (provider.project !== '') headers['OpenAI-Project'] = provider.project
  return headers
}

export async function discoverModels(
  provider: ProviderConfig,
  apiKey: string | undefined,
  fetcher: Fetch,
): Promise<Result<ProviderModel[]>> {
  let response: Response
  try {
    response = await fetcher(`${provider.baseUrl}/models`, {
      method: 'GET',
      headers: providerHeaders(provider, apiKey, 'application/json'),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return err('provider/network', 'provider request failed')
  }

  if (!response.ok) return statusError(response.status)

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return err('provider/bad-response', 'provider returned invalid JSON')
  }
  return parseModels(body)
}
