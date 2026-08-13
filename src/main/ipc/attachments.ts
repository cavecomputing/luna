import { randomUUID } from 'node:crypto'
import type {
  AttachmentBytes,
  AttachmentCleanup,
  AttachmentImport,
  AttachmentInput,
  AttachmentStorage,
} from '../../shared/ipc.js'
import { err, ok, type Result } from '../../shared/result.js'
import type { AttachmentMeta } from '../../shared/types.js'
import * as attachments from '../attachments.js'
import * as jobs from '../attachment-jobs.js'
import type { FileContent } from '../attachment-jobs.js'
import * as db from '../db.js'
import { ask } from '../dialogs.js'
import { id, object } from '../parse.js'
import { broadcast, handle } from './bus.js'

type Deps = {
  add: (conversationId: string, files: AttachmentInput[]) => Promise<AttachmentImport | null | undefined>
  list: (conversationId: string) => AttachmentMeta[]
  remove: (conversationId: string, id: string) => boolean
  read: (conversationId: string, id: string) => Promise<FileContent | null | undefined>
  storage: () => Promise<AttachmentStorage | undefined>
  clearUnsent: () => Promise<jobs.UnsentCleanup | undefined>
  confirmClear: () => Promise<boolean>
  notifyDrafts: (conversationId: string, attachments: AttachmentMeta[]) => void
  notifyStorage: () => void
}

async function confirmClear(): Promise<boolean> {
  return (
    (await ask({
      type: 'warning',
      buttons: ['Remove Unsent Attachments', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: 'Remove every unsent attachment?',
      detail:
        'This removes files currently attached in composers across all conversations. ' +
        'Attachments already sent in messages are kept. This cannot be undone.',
    })) === 0
  )
}

const deps: Deps = {
  add: (conversationId, files) =>
    jobs.addFiles(db.filePath(), conversationId, files, files.map(() => randomUUID()), Date.now()),
  list: (conversationId) => attachments.listDrafts(db.handle(), conversationId),
  remove: (conversationId, id) => attachments.removeDraft(db.handle(), conversationId, id),
  read: (conversationId, id) => jobs.readFile(db.filePath(), conversationId, id),
  storage: () => jobs.storage(db.filePath()),
  clearUnsent: () => jobs.clearUnsent(db.filePath()),
  confirmClear,
  notifyDrafts: (conversationId, value) => {
    broadcast('attachments:changed', { conversationId, attachments: value })
  },
  notifyStorage: () => {
    broadcast('attachments:storage-changed', undefined)
  },
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

export async function getStorage(d: Deps): Promise<Result<AttachmentStorage>> {
  const value = await d.storage()
  return value === undefined
    ? err('attachment/io', 'attachment storage could not be read')
    : ok(value)
}

let clearing = false

export async function clearUnsent(d: Deps): Promise<Result<AttachmentCleanup>> {
  if (clearing) return err('attachment/busy', 'attachment cleanup is already in progress')
  clearing = true
  try {
    if (!(await d.confirmClear())) return ok({ removedBytes: 0, removedCount: 0 })
    const value = await d.clearUnsent()
    if (value === undefined) return err('attachment/io', 'unsent attachments could not be removed')
    for (const conversationId of value.conversationIds) {
      d.notifyDrafts(conversationId, d.list(conversationId))
    }
    d.notifyStorage()
    return ok({ removedBytes: value.removedBytes, removedCount: value.removedCount })
  } finally {
    clearing = false
  }
}

export function register(): void {
  handle('attachments:add', async (_event, req) => {
    const result = await addAttachments(req, deps)
    if (result.ok) {
      broadcast('attachments:changed', {
        conversationId: req.conversationId,
        attachments: deps.list(req.conversationId),
      })
      deps.notifyStorage()
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
      deps.notifyStorage()
    }
    return result
  })
  handle('attachments:read', (_event, req) => readAttachment(req, deps))
  handle('attachments:storage', () => getStorage(deps))
  handle('attachments:clear-unsent', () => clearUnsent(deps))
}
