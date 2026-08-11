import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { addFiles, readFile, readHistory } from './attachment-jobs.js'
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
    (id, title, icon, mode, pinned, created_at, updated_at)
    VALUES ('chat-1', 'Chat', 'spark', 'fast', 0, 1, 1)`)
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
})
