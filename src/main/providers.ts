import type { DatabaseSync } from 'node:sqlite'
import type {
  ApiKind,
  ModelSlots,
  Mode,
  Provider,
  ProviderDraft,
  SamplerSettings,
} from '../shared/types.js'
import { defaultSamplerSettings } from '../shared/types.js'
import * as db from './db.js'
import { object } from './parse.js'

export type ProviderConfig = Omit<Provider, 'hasApiKey'>

function api(value: unknown): ApiKind | undefined {
  return value === 'responses' || value === 'chat-completions' ? value : undefined
}

function providerRow(row: unknown): ProviderConfig | undefined {
  const cell = object(row)
  const kind = api(cell?.api)
  if (
    cell === undefined ||
    typeof cell.id !== 'string' ||
    typeof cell.name !== 'string' ||
    typeof cell.base_url !== 'string' ||
    kind === undefined ||
    typeof cell.organization !== 'string' ||
    typeof cell.project !== 'string'
  ) {
    return undefined
  }

  return {
    id: cell.id,
    name: cell.name,
    baseUrl: cell.base_url,
    api: kind,
    organization: cell.organization,
    project: cell.project,
  }
}

export function list(conn: DatabaseSync): ProviderConfig[] {
  const rows = conn
    .prepare(
      `SELECT id, name, base_url, api, organization, project
       FROM providers ORDER BY name COLLATE NOCASE, id`,
    )
    .all()

  return rows.flatMap((row) => {
    const parsed = providerRow(row)
    return parsed === undefined ? [] : [parsed]
  })
}

export function find(conn: DatabaseSync, id: string): ProviderConfig | undefined {
  return providerRow(
    conn
      .prepare(
        `SELECT id, name, base_url, api, organization, project
         FROM providers WHERE id = ?`,
      )
      .get(id),
  )
}

export function create(
  conn: DatabaseSync,
  id: string,
  provider: ProviderDraft,
): ProviderConfig {
  conn
    .prepare(
      `INSERT INTO providers (id, name, base_url, api, organization, project)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      provider.name,
      provider.baseUrl,
      provider.api,
      provider.organization,
      provider.project,
    )

  return { id, ...provider }
}

export function update(
  conn: DatabaseSync,
  id: string,
  provider: ProviderDraft,
): ProviderConfig | undefined {
  const result = conn
    .prepare(
      `UPDATE providers
       SET name = ?, base_url = ?, api = ?, organization = ?, project = ?
       WHERE id = ?`,
    )
    .run(
      provider.name,
      provider.baseUrl,
      provider.api,
      provider.organization,
      provider.project,
      id,
    )

  return result.changes === 0 ? undefined : { id, ...provider }
}

export function remove(conn: DatabaseSync, id: string): boolean {
  return conn.prepare('DELETE FROM providers WHERE id = ?').run(id).changes > 0
}

function optionalNumber(value: unknown): number | null | undefined {
  return value === null || typeof value === 'number' ? value : undefined
}

function slotRow(row: unknown): [Mode, ModelSlots[Mode]] | undefined {
  const cell = object(row)
  if (cell === undefined) return undefined
  const seed = optionalNumber(cell.seed)
  const topK = optionalNumber(cell.top_k)
  const minP = optionalNumber(cell.min_p)
  const repeatPenalty = optionalNumber(cell.repeat_penalty)
  if (
    (cell.slot !== 'fast' && cell.slot !== 'expert') ||
    (typeof cell.provider_id !== 'string' && cell.provider_id !== null) ||
    typeof cell.model !== 'string' ||
    (cell.sampling_enabled !== 0 && cell.sampling_enabled !== 1) ||
    typeof cell.temperature !== 'number' ||
    typeof cell.top_p !== 'number' ||
    typeof cell.frequency_penalty !== 'number' ||
    typeof cell.presence_penalty !== 'number' ||
    seed === undefined ||
    topK === undefined ||
    minP === undefined ||
    repeatPenalty === undefined
  ) {
    return undefined
  }

  return [
    cell.slot,
    {
      providerId: cell.provider_id,
      model: cell.model,
      sampling: {
        enabled: cell.sampling_enabled === 1,
        temperature: cell.temperature,
        topP: cell.top_p,
        frequencyPenalty: cell.frequency_penalty,
        presencePenalty: cell.presence_penalty,
        seed,
        topK,
        minP,
        repeatPenalty,
      },
    },
  ]
}

export function readSlots(conn: DatabaseSync): ModelSlots {
  const slots: ModelSlots = {
    fast: { providerId: null, model: '', sampling: { ...defaultSamplerSettings } },
    expert: { providerId: null, model: '', sampling: { ...defaultSamplerSettings } },
  }

  for (const row of conn.prepare(`SELECT slot, provider_id, model, sampling_enabled,
    temperature, top_p, frequency_penalty, presence_penalty, seed, top_k, min_p,
    repeat_penalty FROM model_slots`).all()) {
    const parsed = slotRow(row)
    if (parsed !== undefined) slots[parsed[0]] = parsed[1]
  }

  return slots
}

export function writeSampling(
  conn: DatabaseSync,
  slot: Mode,
  sampling: SamplerSettings,
): ModelSlots {
  conn.prepare(`UPDATE model_slots SET sampling_enabled = ?, temperature = ?, top_p = ?,
    frequency_penalty = ?, presence_penalty = ?, seed = ?, top_k = ?, min_p = ?,
    repeat_penalty = ? WHERE slot = ?`).run(
    sampling.enabled ? 1 : 0,
    sampling.temperature,
    sampling.topP,
    sampling.frequencyPenalty,
    sampling.presencePenalty,
    sampling.seed,
    sampling.topK,
    sampling.minP,
    sampling.repeatPenalty,
    slot,
  )
  return readSlots(conn)
}

export function writeSlot(
  conn: DatabaseSync,
  slot: Mode,
  providerId: string | null,
  model: string,
): ModelSlots {
  conn
    .prepare('UPDATE model_slots SET provider_id = ?, model = ? WHERE slot = ?')
    .run(providerId, model, slot)
  return readSlots(conn)
}

export function load(): ProviderConfig[] {
  return list(db.handle())
}

export function get(id: string): ProviderConfig | undefined {
  return find(db.handle(), id)
}

export function add(id: string, provider: ProviderDraft): ProviderConfig {
  return create(db.handle(), id, provider)
}

export function save(id: string, provider: ProviderDraft): ProviderConfig | undefined {
  return update(db.handle(), id, provider)
}

export function drop(id: string): boolean {
  return remove(db.handle(), id)
}

export function slots(): ModelSlots {
  return readSlots(db.handle())
}

export function setSlot(slot: Mode, providerId: string | null, model: string): ModelSlots {
  return writeSlot(db.handle(), slot, providerId, model)
}

export function setSampling(slot: Mode, sampling: SamplerSettings): ModelSlots {
  return writeSampling(db.handle(), slot, sampling)
}
