import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { AttachmentInput } from '../shared/ipc.js'
import { migrate } from './migrations.js'
import {
  addFiles,
  bindDrafts,
  cleanName,
  historyMap,
  inspectFile,
  listDrafts,
  readFile,
  removeDraft,
} from './attachments.js'

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  db.exec(`INSERT INTO conversations
    (id, title, icon, mode, pinned, created_at, updated_at)
    VALUES ('chat-1', 'Chat', 'spark', 'fast', 0, 1, 1)`)
  return db
}

function file(name: string, text: string): AttachmentInput {
  return { name, mediaType: 'text/plain', data: new TextEncoder().encode(text) }
}

describe('attachment validation', () => {
  it('sanitizes paths and control characters from names', () => {
    expect(cleanName('../folder/secret\u0000.txt')).toBe('secret_.txt')
  })

  it('recognizes supported images, PDFs, and UTF-8 text', () => {
    expect(inspectFile({ ...file('image.png', ''), data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]) })).toMatchObject({ kind: 'image', mediaType: 'image/png' })
    expect(inspectFile({ ...file('doc.pdf', ''), data: new TextEncoder().encode('%PDF-1.7') })).toMatchObject({ kind: 'pdf' })
    expect(inspectFile(file('notes.md', '# Notes'))).toMatchObject({ kind: 'text' })
  })

  it('rejects archives and animated GIFs', () => {
    expect(inspectFile({ ...file('archive.zip', ''), data: Uint8Array.from([0x50, 0x4b, 3, 4]) })).toBe('attachment/unsupported-type')
    expect(inspectFile({ ...file('moving.gif', ''), data: new TextEncoder().encode('GIF89aNETSCAPE2.0') })).toBe('attachment/animated-gif')
  })

  it('rejects image and PDF names whose bytes do not match', () => {
    expect(inspectFile(file('fake.png', 'plain text'))).toBe('attachment/invalid')
    expect(inspectFile(file('fake.pdf', 'plain text'))).toBe('attachment/invalid')
  })
})

describe('attachment storage', () => {
  it('persists drafts and returns their original bytes', () => {
    const db = database()
    const result = addFiles(db, 'chat-1', [file('notes.txt', 'hello')], () => 'file-1', 2)
    expect(result).toEqual({
      accepted: [{ id: 'file-1', name: 'notes.txt', kind: 'text', mediaType: 'text/plain', size: 5 }],
      rejected: [],
    })
    expect(listDrafts(db, 'chat-1')).toEqual(result?.accepted)
    expect(new TextDecoder().decode(readFile(db, 'chat-1', 'file-1')?.data)).toBe('hello')
  })

  it('binds selected drafts to a message in their selected order', () => {
    const db = database()
    addFiles(db, 'chat-1', [file('a.txt', 'a'), file('b.txt', 'b')], (() => {
      let value = 0
      return () => `file-${String(++value)}`
    })(), 2)
    db.exec(`INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'user', '', 'complete', 2, 0)`)
    expect(bindDrafts(db, 'chat-1', 'message-1', ['file-2', 'file-1'])).toBe(true)
    expect(listDrafts(db, 'chat-1')).toEqual([])
    expect(historyMap(db, 'chat-1').get('message-1')?.map((item) => item.id)).toEqual(['file-2', 'file-1'])
  })

  it('only removes unsent attachments owned by the conversation', () => {
    const db = database()
    addFiles(db, 'chat-1', [file('notes.txt', 'hello')], () => 'file-1', 2)
    expect(removeDraft(db, 'other-chat', 'file-1')).toBe(false)
    expect(removeDraft(db, 'chat-1', 'file-1')).toBe(true)
  })

  it('returns missing for a conversation that does not exist', () => {
    expect(addFiles(database(), 'missing', [file('notes.txt', 'hello')], () => 'file-1', 2)).toBeUndefined()
  })
})
