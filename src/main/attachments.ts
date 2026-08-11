import type { DatabaseSync } from 'node:sqlite'
import { MAX_ATTACHMENTS, MAX_MESSAGE_ATTACHMENT_BYTES } from '../shared/attachments.js'
import type { AttachmentKind, AttachmentMeta } from '../shared/types.js'
import { object } from './parse.js'

export type StoredAttachment = AttachmentMeta & { data: Uint8Array }

function kind(input: unknown): AttachmentKind | undefined {
  return input === 'image' || input === 'text' || input === 'pdf' ? input : undefined
}

function metaRow(row: unknown): AttachmentMeta | undefined {
  const cell = object(row)
  const parsedKind = kind(cell?.kind)
  if (
    typeof cell?.id !== 'string' ||
    typeof cell.name !== 'string' ||
    parsedKind === undefined ||
    typeof cell.media_type !== 'string' ||
    typeof cell.byte_size !== 'number' ||
    !Number.isSafeInteger(cell.byte_size)
  ) {
    return undefined
  }
  return {
    id: cell.id,
    name: cell.name,
    kind: parsedKind,
    mediaType: cell.media_type,
    size: cell.byte_size,
  }
}

export function listDrafts(conn: DatabaseSync, conversationId: string): AttachmentMeta[] {
  return conn
    .prepare(
      `SELECT id, name, kind, media_type, byte_size FROM attachments
       WHERE conversation_id = ? AND message_id IS NULL ORDER BY ordinal, created_at, id`,
    )
    .all(conversationId)
    .flatMap((row) => {
      const parsed = metaRow(row)
      return parsed === undefined ? [] : [parsed]
    })
}

/** Attachment metadata grouped by message, for every conversation or one. */
export function messageMap(
  conn: DatabaseSync,
  conversationId?: string,
): Map<string, AttachmentMeta[]> {
  const grouped = new Map<string, AttachmentMeta[]>()
  const rows =
    conversationId === undefined
      ? conn
          .prepare(
            `SELECT message_id, id, name, kind, media_type, byte_size FROM attachments
             WHERE message_id IS NOT NULL ORDER BY message_id, ordinal, created_at, id`,
          )
          .all()
      : conn
          .prepare(
            `SELECT message_id, id, name, kind, media_type, byte_size FROM attachments
             WHERE conversation_id = ? AND message_id IS NOT NULL
             ORDER BY message_id, ordinal, created_at, id`,
          )
          .all(conversationId)
  for (const row of rows) {
    const cell = object(row)
    const parsed = metaRow(row)
    if (typeof cell?.message_id !== 'string' || parsed === undefined) continue
    const items = grouped.get(cell.message_id) ?? []
    items.push(parsed)
    grouped.set(cell.message_id, items)
  }
  return grouped
}

export function removeDraft(conn: DatabaseSync, conversationId: string, id: string): boolean {
  return conn
    .prepare(
      'DELETE FROM attachments WHERE id = ? AND conversation_id = ? AND message_id IS NULL',
    )
    .run(id, conversationId).changes > 0
}

export function bindDrafts(
  conn: DatabaseSync,
  conversationId: string,
  messageId: string,
  ids: string[],
): boolean {
  if (ids.length === 0) return true
  const unique = new Set(ids)
  if (unique.size !== ids.length || ids.length > MAX_ATTACHMENTS) return false
  const drafts = listDrafts(conn, conversationId)
  const byId = new Map(drafts.map((item) => [item.id, item]))
  if (ids.some((id) => !byId.has(id))) return false
  if (ids.reduce((sum, id) => sum + (byId.get(id)?.size ?? 0), 0) > MAX_MESSAGE_ATTACHMENT_BYTES) {
    return false
  }
  const update = conn.prepare(
    `UPDATE attachments SET message_id = ?, ordinal = ?
     WHERE id = ? AND conversation_id = ? AND message_id IS NULL`,
  )
  return ids.every((id, ordinal) => update.run(messageId, ordinal, id, conversationId).changes === 1)
}
