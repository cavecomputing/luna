import { net } from 'electron'
import { randomUUID } from 'node:crypto'
import { err, ok, type Result } from '../../shared/result.js'
import type {
  ModelSlots,
  Mode,
  Provider,
  ProviderDraft,
  ProviderModel,
  SamplerSettings,
} from '../../shared/types.js'
import { discoverModels } from '../openai.js'
import { id, object, text } from '../parse.js'
import * as providers from '../providers.js'
import type { ProviderConfig } from '../providers.js'
import * as secrets from '../secrets.js'
import { broadcast, handle } from './bus.js'

type Deps = {
  list: () => ProviderConfig[]
  get: (id: string) => ProviderConfig | undefined
  add: (id: string, provider: ProviderDraft) => ProviderConfig
  save: (id: string, provider: ProviderDraft) => ProviderConfig | undefined
  drop: (id: string) => boolean
  slots: () => ModelSlots
  setSlot: (slot: Mode, providerId: string | null, model: string) => ModelSlots
  setSampling: (slot: Mode, sampling: SamplerSettings) => ModelSlots
  hasKey: (id: string) => Promise<boolean>
  readKey: (id: string) => Promise<string | undefined>
  writeKey: (id: string, value: string) => Promise<void>
  clearKey: (id: string) => Promise<void>
  discover: (
    provider: ProviderConfig,
    apiKey: string | undefined,
  ) => Promise<Result<ProviderModel[]>>
  newId: () => string
  notifyProviders: (value: Provider[]) => void
  notifyModels: (value: ModelSlots) => void
}

const deps: Deps = {
  list: providers.load,
  get: providers.get,
  add: providers.add,
  save: providers.save,
  drop: providers.drop,
  slots: providers.slots,
  setSlot: providers.setSlot,
  setSampling: providers.setSampling,
  hasKey: secrets.has,
  readKey: secrets.read,
  writeKey: secrets.write,
  clearKey: secrets.clear,
  discover: (provider, apiKey) =>
    discoverModels(provider, apiKey, (input, init) => net.fetch(input, init)),
  newId: randomUUID,
  notifyProviders: (value) => {
    broadcast('providers:changed', value)
  },
  notifyModels: (value) => {
    broadcast('models:changed', value)
  },
}

function baseUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 2048) return undefined

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return undefined
  }

  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return undefined
  }

  return url.toString().replace(/\/+$/, '')
}

export function cleanDraft(input: unknown): Result<ProviderDraft> {
  const value = object(input)
  if (value === undefined) return err('provider/invalid', 'provider was not an object')

  const name = text(value.name, 80)
  const url = baseUrl(value.baseUrl)
  const organization = text(value.organization ?? '', 128)
  const project = text(value.project ?? '', 128)
  if (
    name === undefined ||
    name === '' ||
    url === undefined ||
    organization === undefined ||
    project === undefined ||
    (value.api !== 'responses' && value.api !== 'chat-completions')
  ) {
    return err('provider/invalid', 'provider configuration was invalid')
  }

  return ok({
    name,
    baseUrl: url,
    api: value.api,
    organization,
    project,
  })
}

async function decorate(provider: ProviderConfig, d: Deps): Promise<Provider> {
  return { ...provider, hasApiKey: await d.hasKey(provider.id) }
}

export async function listProviders(d: Deps): Promise<Result<Provider[]>> {
  return ok(await Promise.all(d.list().map((provider) => decorate(provider, d))))
}

async function announceProviders(d: Deps): Promise<Provider[]> {
  const value = await Promise.all(d.list().map((provider) => decorate(provider, d)))
  d.notifyProviders(value)
  return value
}

export async function createProvider(input: unknown, d: Deps): Promise<Result<Provider>> {
  const parsed = cleanDraft(input)
  if (!parsed.ok) return parsed
  const created = d.add(d.newId(), parsed.value)
  const value = await decorate(created, d)
  await announceProviders(d)
  return ok(value)
}

export async function updateProvider(input: unknown, d: Deps): Promise<Result<Provider>> {
  const req = object(input)
  const providerId = id(req?.id)
  const parsed = cleanDraft(req?.provider)
  if (providerId === undefined || !parsed.ok) {
    return err('provider/invalid', 'provider update was invalid')
  }

  const saved = d.save(providerId, parsed.value)
  if (saved === undefined) return err('provider/missing', 'provider was not found')
  const value = await decorate(saved, d)
  await announceProviders(d)
  return ok(value)
}

export async function setKey(input: unknown, d: Deps): Promise<Result<Provider>> {
  const req = object(input)
  const providerId = id(req?.id)
  if (providerId === undefined || (typeof req?.apiKey !== 'string' && req?.apiKey !== null)) {
    return err('provider/invalid', 'credential update was invalid')
  }
  const provider = d.get(providerId)
  if (provider === undefined) return err('provider/missing', 'provider was not found')
  if (typeof req.apiKey === 'string' && (req.apiKey === '' || req.apiKey.length > 8192)) {
    return err('provider/invalid', 'credential was empty or too long')
  }

  try {
    if (req.apiKey === null) await d.clearKey(providerId)
    else await d.writeKey(providerId, req.apiKey)
  } catch {
    return err('secret/unavailable', 'secure credential storage failed')
  }

  const value = await decorate(provider, d)
  await announceProviders(d)
  return ok(value)
}

export async function deleteProvider(input: unknown, d: Deps): Promise<Result<undefined>> {
  const req = object(input)
  const providerId = id(req?.id)
  if (providerId === undefined) return err('provider/invalid', 'provider id was invalid')
  if (d.get(providerId) === undefined) return err('provider/missing', 'provider was not found')

  try {
    await d.clearKey(providerId)
  } catch {
    return err('secret/unavailable', 'secure credential removal failed')
  }
  d.drop(providerId)
  await announceProviders(d)
  const slots = d.slots()
  d.notifyModels(slots)
  return ok(undefined)
}

export async function getModels(input: unknown, d: Deps): Promise<Result<ProviderModel[]>> {
  const req = object(input)
  const providerId = id(req?.id)
  if (providerId === undefined) return err('provider/invalid', 'provider id was invalid')
  const provider = d.get(providerId)
  if (provider === undefined) return err('provider/missing', 'provider was not found')

  let apiKey: string | undefined
  try {
    apiKey = await d.readKey(providerId)
  } catch {
    return err('secret/unavailable', 'secure credential read failed')
  }
  return d.discover(provider, apiKey)
}

export function getSlots(d: Deps): Result<ModelSlots> {
  return ok(d.slots())
}

export function updateSlot(input: unknown, d: Deps): Result<ModelSlots> {
  const req = object(input)
  if (req === undefined || (req.slot !== 'fast' && req.slot !== 'expert')) {
    return err('model/invalid', 'model slot was invalid')
  }
  const providerId = req.providerId === null ? null : id(req.providerId)
  const model = text(req.model, 256)
  if (
    providerId === undefined ||
    model === undefined ||
    (providerId !== null && d.get(providerId) === undefined)
  ) {
    return err('model/invalid', 'model assignment was invalid')
  }

  const value = d.setSlot(req.slot, providerId, model)
  d.notifyModels(value)
  return ok(value)
}

function bounded(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined
}

function optionalBounded(
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number | null | undefined {
  if (value === null) return null
  const parsed = bounded(value, min, max)
  return parsed !== undefined && (!integer || Number.isSafeInteger(parsed)) ? parsed : undefined
}

export function cleanSampling(input: unknown): Result<SamplerSettings> {
  const value = object(input)
  if (value === undefined || typeof value.enabled !== 'boolean') {
    return err('model/invalid', 'sampler settings were invalid')
  }
  const temperature = bounded(value.temperature, 0, 2)
  const topP = bounded(value.topP, 0, 1)
  const frequencyPenalty = bounded(value.frequencyPenalty, -2, 2)
  const presencePenalty = bounded(value.presencePenalty, -2, 2)
  const seed = optionalBounded(value.seed, 0, Number.MAX_SAFE_INTEGER, true)
  const topK = optionalBounded(value.topK, 0, 1_000_000, true)
  const minP = optionalBounded(value.minP, 0, 1)
  const repeatPenalty = optionalBounded(value.repeatPenalty, 0, 10)
  if (
    temperature === undefined ||
    topP === undefined ||
    frequencyPenalty === undefined ||
    presencePenalty === undefined ||
    seed === undefined ||
    topK === undefined ||
    minP === undefined ||
    repeatPenalty === undefined
  ) {
    return err('model/invalid', 'sampler settings were out of range')
  }
  return ok({
    enabled: value.enabled,
    temperature,
    topP,
    frequencyPenalty,
    presencePenalty,
    seed,
    topK,
    minP,
    repeatPenalty,
  })
}

export function updateSampling(input: unknown, d: Deps): Result<ModelSlots> {
  const req = object(input)
  if (req === undefined || (req.slot !== 'fast' && req.slot !== 'expert')) {
    return err('model/invalid', 'model slot was invalid')
  }
  const sampling = cleanSampling(req.sampling)
  if (!sampling.ok) return sampling
  const value = d.setSampling(req.slot, sampling.value)
  d.notifyModels(value)
  return ok(value)
}

export function register(): void {
  handle('providers:list', () => listProviders(deps))
  handle('providers:create', (_event, req) => createProvider(req, deps))
  handle('providers:update', (_event, req) => updateProvider(req, deps))
  handle('providers:delete', (_event, req) => deleteProvider(req, deps))
  handle('providers:set-key', (_event, req) => setKey(req, deps))
  handle('providers:models', (_event, req) => getModels(req, deps))
  handle('models:get', () => getSlots(deps))
  handle('models:set', (_event, req) => updateSlot(req, deps))
  handle('models:set-sampling', (_event, req) => updateSampling(req, deps))
}
