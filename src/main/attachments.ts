import type { DatabaseSync } from 'node:sqlite'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_CONVERSATION_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
} from '../shared/attachments.js'
import type { AttachmentInput, AttachmentImport } from '../shared/ipc.js'
import type { AttachmentKind, AttachmentMeta } from '../shared/types.js'

export type StoredAttachment = AttachmentMeta & { data: Uint8Array }

type AcceptedFile = {
  name: string
  kind: AttachmentKind
  mediaType: string
  data: Uint8Array
}

function object(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null ? { ...input } : undefined
}

function kind(input: unknown): AttachmentKind | undefined {
  return input === 'image' || input === 'text' || input === 'pdf' ? input : undefined
}

export function cleanName(input: string): string {
  const base = input.split(/[\\/]/).at(-1) ?? ''
  let printable = ''
  for (const character of base) {
    const code = character.charCodeAt(0)
    printable += code < 32 || code === 127 ? '_' : character
  }
  const clean = printable.replace(/\s+/g, ' ').trim()
  return (clean === '' ? 'attachment' : clean).slice(0, 255)
}

function starts(data: Uint8Array, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte)
}

function ascii(data: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...data.slice(start, start + length))
}

function animatedGif(data: Uint8Array): boolean {
  const text = ascii(data, 0, Math.min(data.length, 4096))
  return text.includes('NETSCAPE2.0') || text.includes('ANIMEXTS1.0')
}

export function inspectFile(file: AttachmentInput): AcceptedFile | string {
  const name = cleanName(file.name)
  const data = file.data
  if (data.byteLength === 0) return 'attachment/invalid'
  if (data.byteLength > MAX_ATTACHMENT_BYTES) return 'attachment/too-large'
  if (starts(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { name, kind: 'image', mediaType: 'image/png', data }
  }
  if (starts(data, [0xff, 0xd8, 0xff])) {
    return { name, kind: 'image', mediaType: 'image/jpeg', data }
  }
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP') {
    return { name, kind: 'image', mediaType: 'image/webp', data }
  }
  const gif = ascii(data, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') {
    if (animatedGif(data)) return 'attachment/animated-gif'
    return { name, kind: 'image', mediaType: 'image/gif', data }
  }
  if (ascii(data, 0, 5) === '%PDF-') {
    return { name, kind: 'pdf', mediaType: 'application/pdf', data }
  }
  if (/\.(?:png|jpe?g|webp|gif|pdf)$/i.test(name)) return 'attachment/invalid'

  if (
    starts(data, [0x4d, 0x5a]) ||
    starts(data, [0x7f, 0x45, 0x4c, 0x46]) ||
    starts(data, [0x50, 0x4b, 0x03, 0x04])
  ) {
    return 'attachment/unsupported-type'
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    if (text.includes('\u0000')) return 'attachment/unsupported-type'
    return { name, kind: 'text', mediaType: 'text/plain', data }
  } catch {
    return 'attachment/unsupported-type'
  }
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

function storedRow(row: unknown): StoredAttachment | undefined {
  const meta = metaRow(row)
  const content = object(row)?.content
  if (meta === undefined || !(content instanceof Uint8Array)) return undefined
  return { ...meta, data: content }
}

function numberCell(row: unknown, key: string): number {
  const value = object(row)?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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

export function messageMap(conn: DatabaseSync): Map<string, AttachmentMeta[]> {
  const grouped = new Map<string, AttachmentMeta[]>()
  for (const row of conn
    .prepare(
      `SELECT message_id, id, name, kind, media_type, byte_size FROM attachments
       WHERE message_id IS NOT NULL ORDER BY message_id, ordinal, created_at, id`,
    )
    .all()) {
    const cell = object(row)
    const parsed = metaRow(row)
    if (typeof cell?.message_id !== 'string' || parsed === undefined) continue
    const items = grouped.get(cell.message_id) ?? []
    items.push(parsed)
    grouped.set(cell.message_id, items)
  }
  return grouped
}

export function historyMap(
  conn: DatabaseSync,
  conversationId: string,
): Map<string, StoredAttachment[]> {
  const grouped = new Map<string, StoredAttachment[]>()
  for (const row of conn
    .prepare(
      `SELECT message_id, id, name, kind, media_type, byte_size, content FROM attachments
       WHERE conversation_id = ? AND message_id IS NOT NULL
       ORDER BY message_id, ordinal, created_at, id`,
    )
    .all(conversationId)) {
    const cell = object(row)
    const parsed = storedRow(row)
    if (typeof cell?.message_id !== 'string' || parsed === undefined) continue
    const items = grouped.get(cell.message_id) ?? []
    items.push(parsed)
    grouped.set(cell.message_id, items)
  }
  return grouped
}

export function addFiles(
  conn: DatabaseSync,
  conversationId: string,
  files: AttachmentInput[],
  ids: () => string,
  now: number,
): AttachmentImport | undefined {
  if (conn.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId) === undefined) {
    return undefined
  }
  const drafts = listDrafts(conn, conversationId)
  let count = drafts.length
  let messageBytes = drafts.reduce((sum, item) => sum + item.size, 0)
  let conversationBytes = numberCell(
    conn.prepare('SELECT coalesce(sum(byte_size), 0) AS total FROM attachments WHERE conversation_id = ?').get(conversationId),
    'total',
  )
  let ordinal = numberCell(
    conn.prepare('SELECT coalesce(max(ordinal), -1) + 1 AS next FROM attachments WHERE conversation_id = ? AND message_id IS NULL').get(conversationId),
    'next',
  )
  const accepted: AttachmentMeta[] = []
  const rejected: AttachmentImport['rejected'] = []
  const insert = conn.prepare(
    `INSERT INTO attachments
       (id, conversation_id, message_id, name, kind, media_type, byte_size, content, ordinal, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  )

  conn.exec('BEGIN')
  try {
    for (const file of files) {
      const name = cleanName(file.name)
      const inspected = inspectFile(file)
      if (typeof inspected === 'string') {
        rejected.push({ name, code: inspected })
        continue
      }
      if (count >= MAX_ATTACHMENTS) {
        rejected.push({ name, code: 'attachment/too-many' })
        continue
      }
      if (messageBytes + inspected.data.byteLength > MAX_MESSAGE_ATTACHMENT_BYTES) {
        rejected.push({ name, code: 'attachment/message-too-large' })
        continue
      }
      if (conversationBytes + inspected.data.byteLength > MAX_CONVERSATION_ATTACHMENT_BYTES) {
        rejected.push({ name, code: 'attachment/conversation-too-large' })
        continue
      }
      const meta: AttachmentMeta = {
        id: ids(),
        name: inspected.name,
        kind: inspected.kind,
        mediaType: inspected.mediaType,
        size: inspected.data.byteLength,
      }
      insert.run(
        meta.id,
        conversationId,
        meta.name,
        meta.kind,
        meta.mediaType,
        meta.size,
        inspected.data,
        ordinal,
        now,
      )
      accepted.push(meta)
      count += 1
      messageBytes += meta.size
      conversationBytes += meta.size
      ordinal += 1
    }
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }
  return { accepted, rejected }
}

export function removeDraft(conn: DatabaseSync, conversationId: string, id: string): boolean {
  return conn
    .prepare(
      'DELETE FROM attachments WHERE id = ? AND conversation_id = ? AND message_id IS NULL',
    )
    .run(id, conversationId).changes > 0
}

export function readFile(
  conn: DatabaseSync,
  conversationId: string,
  id: string,
): StoredAttachment | undefined {
  return storedRow(
    conn
      .prepare(
        `SELECT id, name, kind, media_type, byte_size, content FROM attachments
         WHERE id = ? AND conversation_id = ?`,
      )
      .get(id, conversationId),
  )
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
