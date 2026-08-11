import type { DatabaseSync } from 'node:sqlite'
import type {
  ApiKind,
  ModelSlots,
  Mode,
  Provider,
  ProviderDraft,
} from '../shared/types.js'
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

function slotRow(row: unknown): [Mode, { providerId: string | null; model: string }] | undefined {
  const cell = object(row)
  if (cell === undefined) return undefined
  if (
    (cell.slot !== 'fast' && cell.slot !== 'expert') ||
    (typeof cell.provider_id !== 'string' && cell.provider_id !== null) ||
    typeof cell.model !== 'string'
  ) {
    return undefined
  }

  return [cell.slot, { providerId: cell.provider_id, model: cell.model }]
}

export function readSlots(conn: DatabaseSync): ModelSlots {
  const slots: ModelSlots = {
    fast: { providerId: null, model: '' },
    expert: { providerId: null, model: '' },
  }

  for (const row of conn.prepare('SELECT slot, provider_id, model FROM model_slots').all()) {
    const parsed = slotRow(row)
    if (parsed !== undefined) slots[parsed[0]] = parsed[1]
  }

  return slots
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
