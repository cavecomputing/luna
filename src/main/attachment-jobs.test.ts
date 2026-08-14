import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { AttachmentImport } from '../shared/ipc.js'
import { addFiles, clearUnsent, readFile, readHistory, storage } from './attachment-jobs.js'
import { migrate } from './migrations.js'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function database(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'luna-attachments-'))
  temporary.push(directory)
  const file = join(directory, 'luna.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  db.exec(`INSERT INTO conversations
    (id, title, mode, pinned, created_at, updated_at)
    VALUES ('chat-1', 'Chat', 'fast', 0, 1, 1)`)
  db.close()
  return file
}

describe('attachment worker jobs', () => {
  it('validates and stores files without blocking the caller database connection', async () => {
    const file = await database()
    expect(
      await addFiles(
        file,
        'chat-1',
        [{ name: 'notes.txt', mediaType: 'text/plain', data: new TextEncoder().encode('hello') }],
        ['file-1'],
        2,
      ),
    ).toEqual({
      accepted: [{ id: 'file-1', name: 'notes.txt', kind: 'text', mediaType: 'text/plain', size: 5 }],
      rejected: [],
    })
  })

  it('retrieves stored bytes in a worker', async () => {
    const file = await database()
    await addFiles(
      file,
      'chat-1',
      [{ name: 'image.png', mediaType: 'image/png', data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]) }],
      ['file-1'],
      2,
    )
    expect(await readFile(file, 'chat-1', 'file-1')).toEqual({
      kind: 'image',
      mediaType: 'image/png',
      data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
    })
  })

  it('retrieves provider history bytes in message order', async () => {
    const file = await database()
    await addFiles(
      file,
      'chat-1',
      [{ name: 'notes.txt', mediaType: 'text/plain', data: new TextEncoder().encode('hello') }],
      ['file-1'],
      2,
    )
    const db = new DatabaseSync(file)
    db.exec(`INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'user', '', 'complete', 2, 0);
      UPDATE attachments SET message_id = 'message-1' WHERE id = 'file-1';`)
    db.close()
    expect(await readHistory(file, 'chat-1')).toEqual([
      {
        messageId: 'message-1',
        id: 'file-1',
        name: 'notes.txt',
        kind: 'text',
        mediaType: 'text/plain',
        size: 5,
        data: new TextEncoder().encode('hello'),
      },
    ])
  })

  it('returns null for a conversation that does not exist', async () => {
    const file = await database()
    expect(
      await addFiles(
        file,
        'missing',
        [{ name: 'notes.txt', mediaType: 'text/plain', data: new TextEncoder().encode('hello') }],
        ['file-1'],
        2,
      ),
    ).toBeNull()
  })

  it('reports sent and unsent logical storage separately', async () => {
    const file = await database()
    await addFiles(
      file,
      'chat-1',
      [
        { name: 'sent.txt', mediaType: 'text/plain', data: new TextEncoder().encode('sent') },
        { name: 'draft.txt', mediaType: 'text/plain', data: new TextEncoder().encode('draft') },
      ],
      ['sent-file', 'draft-file'],
      2,
    )
    const db = new DatabaseSync(file)
    db.exec(`INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'user', '', 'complete', 2, 0);
      UPDATE attachments SET message_id = 'message-1' WHERE id = 'sent-file';`)
    db.close()

    expect(await storage(file)).toEqual({
      totalBytes: 9,
      totalCount: 2,
      sentBytes: 4,
      sentCount: 1,
      unsentBytes: 5,
      unsentCount: 1,
    })
  })

  it('removes unsent files while preserving attachments on retained messages', async () => {
    const file = await database()
    await addFiles(
      file,
      'chat-1',
      [
        { name: 'sent.txt', mediaType: 'text/plain', data: new TextEncoder().encode('sent') },
        { name: 'draft.txt', mediaType: 'text/plain', data: new TextEncoder().encode('draft') },
      ],
      ['sent-file', 'draft-file'],
      2,
    )
    const db = new DatabaseSync(file)
    db.exec(`INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'user', '', 'complete', 2, 0);
      UPDATE attachments SET message_id = 'message-1' WHERE id = 'sent-file';`)
    db.close()

    expect(await clearUnsent(file)).toEqual({
      conversationIds: ['chat-1'],
      removedBytes: 5,
      removedCount: 1,
    })
    expect(await storage(file)).toEqual({
      totalBytes: 4,
      totalCount: 1,
      sentBytes: 4,
      sentCount: 1,
      unsentBytes: 0,
      unsentCount: 0,
    })
  })
})

describe('attachment validation in the worker', () => {
  async function inspect(name: string, data: Uint8Array): Promise<AttachmentImport> {
    const file = await database()
    const result = await addFiles(file, 'chat-1', [{ name, mediaType: '', data }], ['file-1'], 2)
    if (result === undefined || result === null) throw new Error('worker job failed')
    return result
  }

  it('sanitizes paths and control characters from names', async () => {
    const result = await inspect('../folder/secret\u0000.txt', new TextEncoder().encode('x'))
    expect(result.accepted[0]?.name).toBe('secret_.txt')
  })

  it('recognizes supported images, PDFs, and UTF-8 text', async () => {
    const png = await inspect('image.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))
    expect(png.accepted[0]).toMatchObject({ kind: 'image', mediaType: 'image/png' })
    const pdf = await inspect('doc.pdf', new TextEncoder().encode('%PDF-1.7'))
    expect(pdf.accepted[0]).toMatchObject({ kind: 'pdf', mediaType: 'application/pdf' })
    const text = await inspect('notes.md', new TextEncoder().encode('# Notes'))
    expect(text.accepted[0]).toMatchObject({ kind: 'text', mediaType: 'text/plain' })
  })

  it('rejects archives and animated GIFs', async () => {
    const zip = await inspect('archive.zip', Uint8Array.from([0x50, 0x4b, 3, 4]))
    expect(zip.rejected).toEqual([{ name: 'archive.zip', code: 'attachment/unsupported-type' }])
    const gif = await inspect('moving.gif', new TextEncoder().encode('GIF89aNETSCAPE2.0'))
    expect(gif.rejected).toEqual([{ name: 'moving.gif', code: 'attachment/animated-gif' }])
  })

  it('rejects image and PDF names whose bytes do not match', async () => {
    const png = await inspect('fake.png', new TextEncoder().encode('plain text'))
    expect(png.rejected[0]?.code).toBe('attachment/invalid')
    const pdf = await inspect('fake.pdf', new TextEncoder().encode('plain text'))
    expect(pdf.rejected[0]?.code).toBe('attachment/invalid')
  })
})
