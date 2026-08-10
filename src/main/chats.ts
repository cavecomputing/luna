import type { DatabaseSync } from 'node:sqlite'
import type {
  ApiKind,
  ChatIcon,
  Conversation,
  Message,
  MessageStatus,
  Mode,
  Role,
} from '../shared/types.js'
import * as db from './db.js'

export type StoredMessage = Message & {
  providerId?: string
  providerApi?: ApiKind
  providerItems?: unknown[]
}

export type Turn = {
  conversation: Conversation
  userMessageId: string
  assistantMessageId: string
}

const icons: readonly ChatIcon[] = [
  'wave',
  'bowl',
  'book',
  'dumbbell',
  'leaf',
  'gift',
  'camera',
  'spark',
]

function object(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null ? { ...input } : undefined
}

function mode(input: unknown): Mode | undefined {
  return input === 'fast' || input === 'expert' ? input : undefined
}

function role(input: unknown): Role | undefined {
  return input === 'user' || input === 'assistant' ? input : undefined
}

function status(input: unknown): MessageStatus | undefined {
  return input === 'complete' ||
    input === 'streaming' ||
    input === 'error' ||
    input === 'cancelled'
    ? input
    : undefined
}

function icon(input: unknown): ChatIcon | undefined {
  return icons.find((value) => value === input)
}

function api(input: unknown): ApiKind | undefined {
  return input === 'responses' || input === 'chat-completions' ? input : undefined
}

function providerItems(input: unknown): unknown[] | undefined {
  if (typeof input !== 'string' || input === '') return undefined
  try {
    const parsed: unknown = JSON.parse(input)
    return Array.isArray(parsed) && parsed.every((item) => object(item) !== undefined)
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

function messageRow(row: unknown): (StoredMessage & { conversationId: string }) | undefined {
  const cell = object(row)
  if (cell === undefined) return undefined
  const parsedRole = role(cell.role)
  const parsedStatus = status(cell.status)
  const parsedApi = api(cell.provider_api)
  const parsedItems = providerItems(cell.provider_items)
  if (
    typeof cell.id !== 'string' ||
    typeof cell.conversation_id !== 'string' ||
    parsedRole === undefined ||
    typeof cell.text !== 'string' ||
    typeof cell.reasoning !== 'string' ||
    parsedStatus === undefined ||
    typeof cell.created_at !== 'number' ||
    !Number.isFinite(cell.created_at)
  ) {
    return undefined
  }

  return {
    id: cell.id,
    conversationId: cell.conversation_id,
    role: parsedRole,
    text: cell.text,
    ...(cell.reasoning === '' ? {} : { reasoning: cell.reasoning }),
    status: parsedStatus,
    at: cell.created_at,
    ...(typeof cell.provider_id !== 'string' ? {} : { providerId: cell.provider_id }),
    ...(parsedApi === undefined ? {} : { providerApi: parsedApi }),
    ...(parsedItems === undefined ? {} : { providerItems: parsedItems }),
  }
}

function conversationRow(row: unknown, messages: Message[]): Conversation | undefined {
  const cell = object(row)
  if (cell === undefined) return undefined
  const parsedIcon = icon(cell.icon)
  const parsedMode = mode(cell.mode)
  if (
    typeof cell.id !== 'string' ||
    typeof cell.title !== 'string' ||
    typeof cell.draft !== 'string' ||
    cell.draft.length > 100_000 ||
    parsedIcon === undefined ||
    parsedMode === undefined ||
    (cell.pinned !== 0 && cell.pinned !== 1) ||
    typeof cell.updated_at !== 'number' ||
    !Number.isFinite(cell.updated_at)
  ) {
    return undefined
  }

  return {
    id: cell.id,
    title: cell.title,
    draft: cell.draft,
    icon: parsedIcon,
    mode: parsedMode,
    pinned: cell.pinned === 1,
    updatedAt: cell.updated_at,
    messages,
  }
}

function visibleMessage(message: StoredMessage): Message {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
    status: message.status,
    at: message.at,
    ...(message.streamSeq === undefined ? {} : { streamSeq: message.streamSeq }),
  }
}

export function list(conn: DatabaseSync): Conversation[] {
  const grouped = new Map<string, Message[]>()
  for (const row of conn
    .prepare(
      `SELECT id, conversation_id, role, text, reasoning, status, created_at,
              provider_id, provider_api, provider_items
       FROM messages ORDER BY conversation_id, ordinal`,
    )
    .all()) {
    const parsed = messageRow(row)
    if (parsed === undefined) continue
    const messages = grouped.get(parsed.conversationId) ?? []
    messages.push(visibleMessage(parsed))
    grouped.set(parsed.conversationId, messages)
  }

  return conn
    .prepare(
      `SELECT id, title, draft, icon, mode, pinned, updated_at
       FROM conversations ORDER BY pinned DESC, updated_at DESC, id`,
    )
    .all()
    .flatMap((row) => {
      const cell = object(row)
      const messages = typeof cell?.id === 'string' ? (grouped.get(cell.id) ?? []) : []
      const parsed = conversationRow(row, messages)
      return parsed === undefined ? [] : [parsed]
    })
}

export function find(conn: DatabaseSync, id: string): Conversation | undefined {
  return list(conn).find((conversation) => conversation.id === id)
}

export function history(conn: DatabaseSync, conversationId: string): StoredMessage[] {
  return conn
    .prepare(
      `SELECT id, conversation_id, role, text, reasoning, status, created_at,
              provider_id, provider_api, provider_items
       FROM messages WHERE conversation_id = ? ORDER BY ordinal`,
    )
    .all(conversationId)
    .flatMap((row) => {
      const parsed = messageRow(row)
      if (parsed === undefined) return []
      return [{
        ...visibleMessage(parsed),
        ...(parsed.providerApi === undefined ? {} : { providerApi: parsed.providerApi }),
        ...(parsed.providerId === undefined ? {} : { providerId: parsed.providerId }),
        ...(parsed.providerItems === undefined ? {} : { providerItems: parsed.providerItems }),
      }]
    })
}

export function messageText(conn: DatabaseSync, id: string): string | undefined {
  const row = conn.prepare('SELECT text FROM messages WHERE id = ?').get(id)
  const cell = object(row)
  return typeof cell?.text === 'string' ? cell.text : undefined
}

export function create(
  conn: DatabaseSync,
  id: string,
  selectedMode: Mode,
  now: number,
): Conversation {
  conn
    .prepare(
      `INSERT INTO conversations (id, title, icon, mode, pinned, created_at, updated_at)
       VALUES (?, 'New chat', 'spark', ?, 0, ?, ?)`,
    )
    .run(id, selectedMode, now, now)
  return {
    id,
    title: 'New chat',
    draft: '',
    icon: 'spark',
    mode: selectedMode,
    pinned: false,
    updatedAt: now,
    messages: [],
  }
}

function updateConversation(
  conn: DatabaseSync,
  id: string,
  sql: string,
  value: string | number,
): Conversation | undefined {
  const result = conn.prepare(sql).run(value, id)
  return result.changes === 0 ? undefined : find(conn, id)
}

export function setMode(
  conn: DatabaseSync,
  id: string,
  selectedMode: Mode,
): Conversation | undefined {
  return updateConversation(conn, id, 'UPDATE conversations SET mode = ? WHERE id = ?', selectedMode)
}

export function setPinned(
  conn: DatabaseSync,
  id: string,
  pinned: boolean,
): Conversation | undefined {
  return updateConversation(
    conn,
    id,
    'UPDATE conversations SET pinned = ? WHERE id = ?',
    pinned ? 1 : 0,
  )
}

export function setTitle(
  conn: DatabaseSync,
  id: string,
  title: string,
): Conversation | undefined {
  return updateConversation(conn, id, 'UPDATE conversations SET title = ? WHERE id = ?', title)
}

export function setDraft(conn: DatabaseSync, id: string, draft: string): boolean {
  return conn.prepare('UPDATE conversations SET draft = ? WHERE id = ?').run(draft, id).changes > 0
}

export function remove(conn: DatabaseSync, id: string): boolean {
  return conn.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0
}

export function beginTurn(
  conn: DatabaseSync,
  conversationId: string,
  text: string,
  userMessageId: string,
  assistantMessageId: string,
  now: number,
): Turn | undefined {
  conn.exec('BEGIN')
  try {
    const exists = conn
      .prepare('SELECT id FROM conversations WHERE id = ?')
      .get(conversationId)
    if (exists === undefined) {
      conn.exec('ROLLBACK')
      return undefined
    }

    const row = conn
      .prepare('SELECT coalesce(max(ordinal), -1) AS ordinal FROM messages WHERE conversation_id = ?')
      .get(conversationId)
    const cell = object(row)
    const next = typeof cell?.ordinal === 'number' ? cell.ordinal + 1 : 0
    const insert = conn.prepare(
      `INSERT INTO messages
         (id, conversation_id, role, text, status, created_at, ordinal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run(userMessageId, conversationId, 'user', text, 'complete', now, next)
    insert.run(assistantMessageId, conversationId, 'assistant', '', 'streaming', now, next + 1)
    conn
      .prepare("UPDATE conversations SET updated_at = ?, draft = '' WHERE id = ?")
      .run(now, conversationId)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }

  const conversation = find(conn, conversationId)
  return conversation === undefined
    ? undefined
    : { conversation, userMessageId, assistantMessageId }
}

export function finishMessage(
  conn: DatabaseSync,
  id: string,
  text: string,
  reasoning: string,
  finalStatus: Exclude<MessageStatus, 'streaming'>,
  now: number,
  providerApi?: ApiKind,
  providerId?: string,
  items?: unknown[],
): Message | undefined {
  conn.exec('BEGIN')
  try {
    const result = conn
      .prepare(
        `UPDATE messages
         SET text = ?, reasoning = ?, status = ?, provider_id = ?, provider_api = ?, provider_items = ?
         WHERE id = ? AND role = 'assistant' AND status = 'streaming'`,
      )
      .run(
        text,
        reasoning,
        finalStatus,
        providerId ?? null,
        providerApi ?? null,
        items === undefined ? null : JSON.stringify(items),
        id,
      )
    if (result.changes === 0) {
      conn.exec('ROLLBACK')
      return undefined
    }
    conn
      .prepare(
        `UPDATE conversations SET updated_at = ?
         WHERE id = (SELECT conversation_id FROM messages WHERE id = ?)`,
      )
      .run(now, id)
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }

  const parsed = messageRow(
    conn
      .prepare(
        `SELECT id, conversation_id, role, text, reasoning, status, created_at,
                provider_id, provider_api, provider_items
         FROM messages WHERE id = ?`,
      )
      .get(id),
  )
  if (parsed === undefined) return undefined
  return visibleMessage(parsed)
}

/** Marks requests abandoned by a prior process as interrupted on next launch. */
export function recoverInterrupted(conn: DatabaseSync): number {
  return Number(conn
    .prepare("UPDATE messages SET status = 'error' WHERE status = 'streaming'")
    .run().changes)
}

export function load(): Conversation[] {
  return list(db.handle())
}

export function get(id: string): Conversation | undefined {
  return find(db.handle(), id)
}

export function transcript(id: string): StoredMessage[] {
  return history(db.handle(), id)
}

export function text(id: string): string | undefined {
  return messageText(db.handle(), id)
}
