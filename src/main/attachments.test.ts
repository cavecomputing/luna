import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from './migrations.js'
import { bindDrafts, listDrafts, messageMap, removeDraft } from './attachments.js'

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  db.exec(`INSERT INTO conversations
    (id, title, icon, mode, pinned, created_at, updated_at)
    VALUES ('chat-1', 'Chat', 'spark', 'fast', 0, 1, 1)`)
  return db
}

function seed(
  db: DatabaseSync,
  id: string,
  name: string,
  ordinal: number,
  messageId: string | null = null,
): void {
  const data = new TextEncoder().encode(name)
  db.prepare(
    `INSERT INTO attachments
       (id, conversation_id, message_id, name, kind, media_type, byte_size, content, ordinal, created_at)
     VALUES (?, ?, ?, ?, 'text', 'text/plain', ?, ?, ?, 2)`,
  ).run(id, 'chat-1', messageId, name, data.byteLength, data, ordinal)
}

describe('attachment storage', () => {
  it('lists drafts in ordinal order', () => {
    const db = database()
    seed(db, 'file-2', 'b.txt', 1)
    seed(db, 'file-1', 'a.txt', 0)
    expect(listDrafts(db, 'chat-1').map((item) => item.id)).toEqual(['file-1', 'file-2'])
  })

  it('binds selected drafts to a message in their selected order', () => {
    const db = database()
    seed(db, 'file-1', 'a.txt', 0)
    seed(db, 'file-2', 'b.txt', 1)
    db.exec(`INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'user', '', 'complete', 2, 0)`)
    expect(bindDrafts(db, 'chat-1', 'message-1', ['file-2', 'file-1'])).toBe(true)
    expect(listDrafts(db, 'chat-1')).toEqual([])
    expect(messageMap(db).get('message-1')?.map((item) => item.id)).toEqual(['file-2', 'file-1'])
  })

  it('refuses duplicate, unknown, or oversized draft selections', () => {
    const db = database()
    seed(db, 'file-1', 'a.txt', 0)
    expect(bindDrafts(db, 'chat-1', 'message-1', ['file-1', 'file-1'])).toBe(false)
    expect(bindDrafts(db, 'chat-1', 'message-1', ['missing'])).toBe(false)
    expect(
      bindDrafts(db, 'chat-1', 'message-1', ['file-1', 'file-2', 'file-3', 'file-4', 'file-5', 'file-6']),
    ).toBe(false)
  })

  it('only removes unsent attachments owned by the conversation', () => {
    const db = database()
    seed(db, 'file-1', 'notes.txt', 0)
    expect(removeDraft(db, 'other-chat', 'file-1')).toBe(false)
    expect(removeDraft(db, 'chat-1', 'file-1')).toBe(true)
  })
})
