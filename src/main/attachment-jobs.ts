import { Worker } from 'node:worker_threads'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_CONVERSATION_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
} from '../shared/attachments.js'
import type { AttachmentInput, AttachmentImport } from '../shared/ipc.js'
import type { AttachmentKind, AttachmentMeta } from '../shared/types.js'
import { object } from './parse.js'

type AddJob = {
  operation: 'add'
  database: string
  conversationId: string
  files: AttachmentInput[]
  ids: string[]
  now: number
}

type ReadJob = {
  operation: 'read'
  database: string
  conversationId: string
  id: string
}

export type FileContent = {
  kind: AttachmentKind
  mediaType: string
  data: Uint8Array
}

type HistoryJob = {
  operation: 'history'
  database: string
  conversationId: string
}

type Job = AddJob | ReadJob | HistoryJob

export type HistoryAttachment = AttachmentMeta & {
  messageId: string
  data: Uint8Array
}

type JobResult =
  | { ok: true; value: unknown }
  | { ok: false }

const source = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const { DatabaseSync } = require('node:sqlite')

// Limits come from shared/attachments.js at bundle time, so the worker and
// the rest of the app cannot drift apart.
const MAX_FILES = ${MAX_ATTACHMENTS}
const MAX_FILE = ${MAX_ATTACHMENT_BYTES}
const MAX_MESSAGE = ${MAX_MESSAGE_ATTACHMENT_BYTES}
const MAX_CONVERSATION = ${MAX_CONVERSATION_ATTACHMENT_BYTES}

function cleanName(input) {
  const parts = input.split(/[\\/]/)
  const base = parts[parts.length - 1] || ''
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim()
  return (clean === '' ? 'attachment' : clean).slice(0, 255)
}

function starts(data, bytes) {
  return bytes.every((byte, index) => data[index] === byte)
}

function ascii(data, start, length) {
  return String.fromCharCode(...data.slice(start, start + length))
}

function inspect(file) {
  const name = cleanName(file.name)
  const data = file.data
  if (!(data instanceof Uint8Array) || data.byteLength === 0) return { name, code: 'attachment/invalid' }
  if (data.byteLength > MAX_FILE) return { name, code: 'attachment/too-large' }
  if (starts(data, [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])) return { name, kind: 'image', mediaType: 'image/png', data }
  if (starts(data, [0xff, 0xd8, 0xff])) return { name, kind: 'image', mediaType: 'image/jpeg', data }
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP') return { name, kind: 'image', mediaType: 'image/webp', data }
  const gif = ascii(data, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') {
    const header = ascii(data, 0, Math.min(data.length, 4096))
    if (header.includes('NETSCAPE2.0') || header.includes('ANIMEXTS1.0')) return { name, code: 'attachment/animated-gif' }
    return { name, kind: 'image', mediaType: 'image/gif', data }
  }
  if (ascii(data, 0, 5) === '%PDF-') return { name, kind: 'pdf', mediaType: 'application/pdf', data }
  if (/\.(?:png|jpe?g|webp|gif|pdf)$/i.test(name)) return { name, code: 'attachment/invalid' }
  if (starts(data, [0x4d, 0x5a]) || starts(data, [0x7f, 0x45, 0x4c, 0x46]) || starts(data, [0x50, 0x4b, 3, 4])) return { name, code: 'attachment/unsupported-type' }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    if (text.includes('\u0000')) return { name, code: 'attachment/unsupported-type' }
    return { name, kind: 'text', mediaType: 'text/plain', data }
  } catch {
    return { name, code: 'attachment/unsupported-type' }
  }
}

function number(row, key) {
  return row && typeof row[key] === 'number' ? row[key] : 0
}

function add(db, job) {
  if (db.prepare('SELECT id FROM conversations WHERE id = ?').get(job.conversationId) === undefined) return null
  let count = number(db.prepare('SELECT count(*) AS value FROM attachments WHERE conversation_id = ? AND message_id IS NULL').get(job.conversationId), 'value')
  let messageBytes = number(db.prepare('SELECT coalesce(sum(byte_size), 0) AS value FROM attachments WHERE conversation_id = ? AND message_id IS NULL').get(job.conversationId), 'value')
  let conversationBytes = number(db.prepare('SELECT coalesce(sum(byte_size), 0) AS value FROM attachments WHERE conversation_id = ?').get(job.conversationId), 'value')
  let ordinal = number(db.prepare('SELECT coalesce(max(ordinal), -1) + 1 AS value FROM attachments WHERE conversation_id = ? AND message_id IS NULL').get(job.conversationId), 'value')
  const accepted = []
  const rejected = []
  const insert = db.prepare('INSERT INTO attachments (id, conversation_id, message_id, name, kind, media_type, byte_size, content, ordinal, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)')
  db.exec('BEGIN')
  try {
    for (let index = 0; index < job.files.length; index += 1) {
      const checked = inspect(job.files[index])
      if (checked.code) { rejected.push({ name: checked.name, code: checked.code }); continue }
      if (count >= MAX_FILES) { rejected.push({ name: checked.name, code: 'attachment/too-many' }); continue }
      if (messageBytes + checked.data.byteLength > MAX_MESSAGE) { rejected.push({ name: checked.name, code: 'attachment/message-too-large' }); continue }
      if (conversationBytes + checked.data.byteLength > MAX_CONVERSATION) { rejected.push({ name: checked.name, code: 'attachment/conversation-too-large' }); continue }
      const meta = { id: job.ids[index], name: checked.name, kind: checked.kind, mediaType: checked.mediaType, size: checked.data.byteLength }
      insert.run(meta.id, job.conversationId, meta.name, meta.kind, meta.mediaType, meta.size, checked.data, ordinal, job.now)
      accepted.push(meta)
      count += 1
      messageBytes += meta.size
      conversationBytes += meta.size
      ordinal += 1
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { accepted, rejected }
}

function read(db, job) {
  const row = db.prepare('SELECT kind, media_type, content FROM attachments WHERE id = ? AND conversation_id = ?').get(job.id, job.conversationId)
  if (!row || !(row.content instanceof Uint8Array)) return null
  return { kind: row.kind, mediaType: row.media_type, data: row.content }
}

function history(db, job) {
  return db.prepare('SELECT message_id, id, name, kind, media_type, byte_size, content FROM attachments WHERE conversation_id = ? AND message_id IS NOT NULL ORDER BY message_id, ordinal, created_at, id').all(job.conversationId).map(row => ({
    messageId: row.message_id,
    id: row.id,
    name: row.name,
    kind: row.kind,
    mediaType: row.media_type,
    size: row.byte_size,
    data: row.content,
  }))
}

try {
  const db = new DatabaseSync(workerData.database)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  const value = workerData.operation === 'add'
    ? add(db, workerData)
    : workerData.operation === 'history'
      ? history(db, workerData)
      : read(db, workerData)
  db.close()
  parentPort.postMessage({ ok: true, value })
} catch {
  parentPort.postMessage({ ok: false })
}
`

const pending = new Set<Promise<JobResult>>()

function run(job: Job): Promise<JobResult> {
  const task = new Promise<JobResult>((resolve) => {
    const worker = new Worker(source, { eval: true, workerData: job })
    let settled = false
    worker.once('message', (value: unknown) => {
      settled = true
      const cell = object(value)
      if (cell === undefined) {
        resolve({ ok: false })
        return
      }
      resolve(cell.ok === true ? { ok: true, value: cell.value } : { ok: false })
    })
    worker.once('error', () => {
      if (!settled) resolve({ ok: false })
    })
    worker.once('exit', () => {
      if (!settled) resolve({ ok: false })
    })
  })
  pending.add(task)
  void task.finally(() => pending.delete(task))
  return task
}

/** Resolves after every attachment worker already in flight has closed its database. */
export async function settle(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending])
}

function meta(input: unknown): AttachmentMeta | undefined {
  const value = object(input)
  if (
    typeof value?.id !== 'string' ||
    typeof value.name !== 'string' ||
    (value.kind !== 'image' && value.kind !== 'text' && value.kind !== 'pdf') ||
    typeof value.mediaType !== 'string' ||
    typeof value.size !== 'number'
  ) {
    return undefined
  }
  return {
    id: value.id,
    name: value.name,
    kind: value.kind,
    mediaType: value.mediaType,
    size: value.size,
  }
}

function imported(input: unknown): AttachmentImport | undefined {
  const value = object(input)
  if (!Array.isArray(value?.accepted) || !Array.isArray(value.rejected)) return undefined
  const accepted = value.accepted.flatMap((item) => {
    const parsed = meta(item)
    return parsed === undefined ? [] : [parsed]
  })
  const rejected = value.rejected.flatMap((item) => {
    const parsed = object(item)
    return typeof parsed?.name === 'string' && typeof parsed.code === 'string'
      ? [{ name: parsed.name, code: parsed.code }]
      : []
  })
  return accepted.length === value.accepted.length && rejected.length === value.rejected.length
    ? { accepted, rejected }
    : undefined
}

export async function addFiles(
  database: string,
  conversationId: string,
  files: AttachmentInput[],
  ids: string[],
  now: number,
): Promise<AttachmentImport | null | undefined> {
  const result = await run({ operation: 'add', database, conversationId, files, ids, now })
  if (!result.ok) return undefined
  const value = result.value
  if (value === null) return null
  return imported(value)
}

export async function readFile(
  database: string,
  conversationId: string,
  id: string,
): Promise<FileContent | null | undefined> {
  const result = await run({ operation: 'read', database, conversationId, id })
  if (!result.ok) return undefined
  const value = result.value
  if (value === null) return null
  const parsed = object(value)
  if (
    (parsed?.kind !== 'image' && parsed?.kind !== 'text' && parsed?.kind !== 'pdf') ||
    typeof parsed.mediaType !== 'string' ||
    !(parsed.data instanceof Uint8Array)
  ) {
    return undefined
  }
  return { kind: parsed.kind, mediaType: parsed.mediaType, data: parsed.data }
}

function historyAttachment(input: unknown): HistoryAttachment | undefined {
  const parsed = object(input)
  const parsedMeta = meta(parsed)
  if (
    parsedMeta === undefined ||
    typeof parsed?.messageId !== 'string' ||
    !(parsed.data instanceof Uint8Array)
  ) {
    return undefined
  }
  return { ...parsedMeta, messageId: parsed.messageId, data: parsed.data }
}

export async function readHistory(
  database: string,
  conversationId: string,
): Promise<HistoryAttachment[] | undefined> {
  const result = await run({ operation: 'history', database, conversationId })
  if (!result.ok || !Array.isArray(result.value)) return undefined
  const parsed = result.value.flatMap((item) => {
    const attachment = historyAttachment(item)
    return attachment === undefined ? [] : [attachment]
  })
  return parsed.length === result.value.length ? parsed : undefined
}
