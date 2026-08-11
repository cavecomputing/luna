import { randomUUID } from 'node:crypto'
import type { AttachmentInput, AttachmentBytes, AttachmentImport } from '../../shared/ipc.js'
import { err, ok, type Result } from '../../shared/result.js'
import type { AttachmentMeta } from '../../shared/types.js'
import * as attachments from '../attachments.js'
import * as jobs from '../attachment-jobs.js'
import type { FileContent } from '../attachment-jobs.js'
import * as db from '../db.js'
import { id, object } from '../parse.js'
import { broadcast, handle } from './bus.js'

type Deps = {
  add: (conversationId: string, files: AttachmentInput[]) => Promise<AttachmentImport | null | undefined>
  list: (conversationId: string) => AttachmentMeta[]
  remove: (conversationId: string, id: string) => boolean
  read: (conversationId: string, id: string) => Promise<FileContent | null | undefined>
}

const deps: Deps = {
  add: (conversationId, files) =>
    jobs.addFiles(db.filePath(), conversationId, files, files.map(() => randomUUID()), Date.now()),
  list: (conversationId) => attachments.listDrafts(db.handle(), conversationId),
  remove: (conversationId, id) => attachments.removeDraft(db.handle(), conversationId, id),
  read: (conversationId, id) => jobs.readFile(db.filePath(), conversationId, id),
}

function inputFile(input: unknown): AttachmentInput | undefined {
  const value = object(input)
  if (
    typeof value?.name !== 'string' ||
    value.name.length > 1024 ||
    typeof value.mediaType !== 'string' ||
    value.mediaType.length > 100 ||
    !(value.data instanceof Uint8Array)
  ) {
    return undefined
  }
  return { name: value.name, mediaType: value.mediaType, data: value.data }
}

export async function addAttachments(input: unknown, d: Deps): Promise<Result<AttachmentImport>> {
  const req = object(input)
  const conversationId = id(req?.conversationId)
  if (conversationId === undefined || !Array.isArray(req?.files) || req.files.length > 20) {
    return err('attachment/invalid', 'attachment import was invalid')
  }
  const files = req.files.flatMap((file) => {
    const parsed = inputFile(file)
    return parsed === undefined ? [] : [parsed]
  })
  if (files.length !== req.files.length) {
    return err('attachment/invalid', 'attachment import was invalid')
  }
  const result = await d.add(conversationId, files)
  if (result === undefined) return err('attachment/io', 'attachment import failed')
  return result === null ? err('chat/missing', 'conversation was not found') : ok(result)
}

export function listAttachments(input: unknown, d: Deps): Result<AttachmentMeta[]> {
  const conversationId = id(object(input)?.conversationId)
  return conversationId === undefined
    ? err('attachment/invalid', 'conversation id was invalid')
    : ok(d.list(conversationId))
}

export function removeAttachment(input: unknown, d: Deps): Result<undefined> {
  const req = object(input)
  const conversationId = id(req?.conversationId)
  const attachmentId = id(req?.id)
  if (conversationId === undefined || attachmentId === undefined) {
    return err('attachment/invalid', 'attachment identity was invalid')
  }
  return d.remove(conversationId, attachmentId)
    ? ok(undefined)
    : err('attachment/missing', 'draft attachment was not found')
}

export async function readAttachment(input: unknown, d: Deps): Promise<Result<AttachmentBytes>> {
  const req = object(input)
  const conversationId = id(req?.conversationId)
  const attachmentId = id(req?.id)
  if (conversationId === undefined || attachmentId === undefined) {
    return err('attachment/invalid', 'attachment identity was invalid')
  }
  const file = await d.read(conversationId, attachmentId)
  if (file === undefined) return err('attachment/io', 'attachment read failed')
  if (file === null) return err('attachment/missing', 'attachment was not found')
  if (file.kind !== 'image') return err('attachment/not-image', 'attachment has no image preview')
  return ok({ mediaType: file.mediaType, data: file.data })
}

export function register(): void {
  handle('attachments:add', async (_event, req) => {
    const result = await addAttachments(req, deps)
    if (result.ok) {
      broadcast('attachments:changed', {
        conversationId: req.conversationId,
        attachments: deps.list(req.conversationId),
      })
    }
    return result
  })
  handle('attachments:list', (_event, req) => listAttachments(req, deps))
  handle('attachments:remove', (_event, req) => {
    const result = removeAttachment(req, deps)
    if (result.ok) {
      broadcast('attachments:changed', {
        conversationId: req.conversationId,
        attachments: deps.list(req.conversationId),
      })
    }
    return result
  })
  handle('attachments:read', (_event, req) => readAttachment(req, deps))
}
