import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { latest, migrate, version } from './migrations.js'

function fresh(): DatabaseSync {
  return new DatabaseSync(':memory:')
}

function tables(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
  return rows.map((row) => {
    const cell: Record<string, unknown> = { ...row }
    return typeof cell.name === 'string' ? cell.name : ''
  })
}

function dropSampling(db: DatabaseSync): void {
  for (const column of [
    'sampling_enabled',
    'temperature',
    'top_p',
    'frequency_penalty',
    'presence_penalty',
    'seed',
    'top_k',
    'min_p',
    'repeat_penalty',
  ]) {
    db.exec(`ALTER TABLE model_slots DROP COLUMN ${column}`)
  }
}

/** Puts back the conversation glyph column so a rewound replay can drop it again. */
function restoreIcon(db: DatabaseSync): void {
  db.exec("ALTER TABLE conversations ADD COLUMN icon TEXT NOT NULL DEFAULT 'spark'")
}

/**
 * Takes the tool-step and usage columns back off. Their steps only add columns,
 * so a replay that rewinds below them would otherwise fail on a duplicate name
 * rather than on whatever the test is actually about.
 */
function dropToolColumns(db: DatabaseSync): void {
  for (const column of [
    'tool_steps',
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cached_tokens',
  ]) {
    db.exec(`ALTER TABLE messages DROP COLUMN ${column}`)
  }
}

/** Takes the tool grant table back off, so its creating step can run again. */
function dropToolGrants(db: DatabaseSync): void {
  db.exec('DROP TABLE tool_grants')
}

/** Removes the context-window and trimmed columns for the same reason. */
function dropContextColumns(db: DatabaseSync): void {
  db.exec('ALTER TABLE model_slots DROP COLUMN context_tokens')
  db.exec('ALTER TABLE messages DROP COLUMN trimmed')
}

/** Every rewind helper, for a replay that goes back before the newest steps. */
function rewind(db: DatabaseSync): void {
  dropContextColumns(db)
  dropToolGrants(db)
  dropToolColumns(db)
  dropSampling(db)
  restoreIcon(db)
}

describe('version', () => {
  it('reports 0 for a database that has never been migrated', () => {
    expect(version(fresh())).toBe(0)
  })
})

describe('migrate', () => {
  it('brings a fresh database to the latest version', () => {
    const db = fresh()
    expect(migrate(db)).toBe(latest)
    expect(version(db)).toBe(latest)
  })

  it('creates the prefs table', () => {
    const db = fresh()
    migrate(db)
    expect(tables(db)).toContain('prefs')
  })

  it('creates provider configuration and both model slots', () => {
    const db = fresh()
    migrate(db)

    expect(tables(db)).toEqual(expect.arrayContaining(['providers', 'model_slots']))
    expect(db.prepare('SELECT id, api FROM providers').all()).toEqual([
      { id: 'openai', api: 'responses' },
    ])
    expect(db.prepare('SELECT slot, provider_id, model FROM model_slots ORDER BY slot').all())
      .toEqual([
        { slot: 'expert', provider_id: 'openai', model: '' },
        { slot: 'fast', provider_id: 'openai', model: '' },
      ])
  })

  it('creates conversation and message storage', () => {
    const db = fresh()
    migrate(db)
    expect(tables(db)).toEqual(expect.arrayContaining(['conversations', 'messages']))
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all(),
    ).toContainEqual({ name: 'messages_by_conversation' })
  })

  it('creates persistent attachment storage', () => {
    const db = fresh()
    migrate(db)
    expect(tables(db)).toContain('attachments')
    expect(db.prepare('PRAGMA table_info(attachments)').all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'content', type: 'BLOB', notnull: 1 }),
        expect.objectContaining({ name: 'message_id', type: 'TEXT', notnull: 0 }),
      ]),
    )
  })

  it('removes the retired editable system prompt preference', () => {
    const db = fresh()
    migrate(db)
    rewind(db)
    // Step index 8 is the systemPrompt deletion, so rewind to just before it.
    // Frozen, so a literal is safer than an offset from a moving `latest`.
    db.exec(`INSERT INTO prefs (key, value) VALUES ('systemPrompt', '"Replace Luna"');
      PRAGMA user_version = 8;`)

    migrate(db)

    expect(db.prepare("SELECT value FROM prefs WHERE key = 'systemPrompt'").get()).toBeUndefined()
  })

  it('does nothing to an already migrated database', () => {
    const db = fresh()
    migrate(db)
    db.exec("INSERT INTO prefs (key, value) VALUES ('theme', '\"dark\"')")

    migrate(db)

    // A step re-run would have thrown on CREATE TABLE, and the row would be gone.
    expect(version(db)).toBe(latest)
    expect(db.prepare('SELECT count(*) AS n FROM prefs').get()).toEqual({ n: 1 })
  })

  it('upgrades a version 1 database without changing its preferences', () => {
    const db = fresh()
    db.exec(`CREATE TABLE prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT INTO prefs (key, value) VALUES ('theme', '"dark"');
      PRAGMA user_version = 1;`)

    migrate(db)

    expect(db.prepare("SELECT value FROM prefs WHERE key = 'theme'").get()).toEqual({
      value: '"dark"',
    })
    expect(tables(db)).toEqual(expect.arrayContaining(['providers', 'model_slots']))
  })

  it('upgrades a version 2 database without changing provider assignments', () => {
    const db = fresh()
    db.exec(`CREATE TABLE prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE providers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
        api TEXT NOT NULL, organization TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE TABLE model_slots (
        slot TEXT PRIMARY KEY, provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        model TEXT NOT NULL DEFAULT ''
      ) STRICT;
      INSERT INTO providers VALUES ('local', 'Local', 'http://localhost:11434/v1', 'responses', '', '');
      INSERT INTO model_slots VALUES ('fast', 'local', 'small'), ('expert', 'local', 'large');
      PRAGMA user_version = 2;`)

    migrate(db)

    expect(db.prepare('SELECT slot, provider_id, model FROM model_slots ORDER BY slot').all())
      .toEqual([
        { slot: 'expert', provider_id: 'local', model: 'large' },
        { slot: 'fast', provider_id: 'local', model: 'small' },
      ])
    expect(tables(db)).toEqual(expect.arrayContaining(['conversations', 'messages']))
  })

  it('upgrades an already-created conversation schema with provider isolation metadata', () => {
    const db = fresh()
    migrate(db)
    db.exec(`PRAGMA user_version = 3;
      DROP TABLE window_state;
      DROP TABLE attachments;
      ALTER TABLE messages DROP COLUMN reasoning;
      ALTER TABLE messages DROP COLUMN provider_id;
      ALTER TABLE conversations DROP COLUMN draft;`)
    rewind(db)

    migrate(db)

    const columns = db.prepare('PRAGMA table_info(messages)').all()
    expect(columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'provider_id', type: 'TEXT' })]),
    )
  })

  it('adds separate reasoning storage without changing existing message text', () => {
    const db = fresh()
    migrate(db)
    db.exec(`INSERT INTO conversations
      (id, title, mode, pinned, created_at, updated_at)
      VALUES ('chat-1', 'Chat', 'fast', 0, 1, 1);
      INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'assistant', 'Answer', 'complete', 1, 0);
      PRAGMA user_version = 4;
      DROP TABLE window_state;
      DROP TABLE attachments;
      ALTER TABLE messages DROP COLUMN reasoning;
      ALTER TABLE conversations DROP COLUMN draft;`)
    rewind(db)

    migrate(db)

    expect(db.prepare('SELECT text, reasoning FROM messages').get()).toEqual({
      text: 'Answer',
      reasoning: '',
    })
  })

  it('adds empty conversation drafts without changing existing chats', () => {
    const db = fresh()
    migrate(db)
    db.exec(`INSERT INTO conversations
      (id, title, mode, pinned, created_at, updated_at, draft)
      VALUES ('chat-1', 'Chat', 'fast', 0, 1, 1, 'temporary');
      PRAGMA user_version = 5;
      DROP TABLE window_state;
      DROP TABLE attachments;
      ALTER TABLE conversations DROP COLUMN draft;`)
    rewind(db)

    migrate(db)

    expect(db.prepare('SELECT title, draft FROM conversations').get()).toEqual({
      title: 'Chat',
      draft: '',
    })
  })

  it('creates storage for each window\'s normal bounds', () => {
    const db = fresh()
    migrate(db)

    expect(tables(db)).toContain('window_state')
    expect(db.prepare('PRAGMA table_info(window_state)').all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', type: 'TEXT', pk: 1 }),
        expect.objectContaining({ name: 'width', type: 'INTEGER', notnull: 1 }),
        expect.objectContaining({ name: 'height', type: 'INTEGER', notnull: 1 }),
      ]),
    )
  })

  it('adds disabled sampler defaults to both model slots', () => {
    const db = fresh()
    migrate(db)

    expect(db.prepare(`SELECT slot, sampling_enabled, temperature, top_p
      FROM model_slots ORDER BY slot`).all()).toEqual([
      { slot: 'expert', sampling_enabled: 0, temperature: 0.7, top_p: 0.95 },
      { slot: 'fast', sampling_enabled: 0, temperature: 0.7, top_p: 0.95 },
    ])
  })

  it('adds tool step and token columns, leaving existing messages untouched', () => {
    const db = fresh()
    migrate(db)
    db.exec(`INSERT INTO conversations
      (id, title, mode, pinned, created_at, updated_at)
      VALUES ('chat-1', 'Chat', 'fast', 0, 1, 1);
      INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'assistant', 'Answer', 'complete', 1, 0);`)
    dropToolColumns(db)
    dropToolGrants(db)
    dropContextColumns(db)
    db.exec('PRAGMA user_version = 11;')

    migrate(db)

    // A message written before the steps existed reads as "nothing recorded",
    // which is deliberately not the same as zero tokens.
    expect(
      db.prepare(`SELECT text, tool_steps, input_tokens, output_tokens,
        reasoning_tokens, cached_tokens FROM messages`).get(),
    ).toEqual({
      text: 'Answer',
      tool_steps: null,
      input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      cached_tokens: null,
    })
  })

  it('leaves integrity and foreign keys clean after every step', () => {
    const db = fresh()
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db)
    db.exec(`INSERT INTO conversations
      (id, title, mode, pinned, created_at, updated_at)
      VALUES ('chat-1', 'Chat', 'fast', 0, 1, 1);
      INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'assistant', 'Answer', 'complete', 1, 0);
      INSERT INTO attachments
      (id, conversation_id, message_id, name, kind, media_type, byte_size, content,
       ordinal, created_at)
      VALUES ('file-1', 'chat-1', 'message-1', 'notes.txt', 'text', 'text/plain', 3,
        x'616263', 0, 1);`)

    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('drops the conversation glyph column and keeps existing chats', () => {
    const db = fresh()
    migrate(db)
    restoreIcon(db)
    dropToolColumns(db)
    dropToolGrants(db)
    dropContextColumns(db)
    db.exec(`INSERT INTO conversations
      (id, title, mode, pinned, created_at, updated_at)
      VALUES ('chat-1', 'Chat', 'fast', 0, 1, 1);
      INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'user', 'Hello', 'complete', 1, 0);
      PRAGMA user_version = 10;`)

    migrate(db)

    const columns = db.prepare('PRAGMA table_info(conversations)').all()
    expect(columns.map((row) => ({ ...row }).name)).not.toContain('icon')
    expect(db.prepare('SELECT title FROM conversations').get()).toEqual({ title: 'Chat' })
    // The cascade onto messages has to survive the column rewrite.
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 1 })
    db.exec("DELETE FROM conversations WHERE id = 'chat-1'")
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 })
  })

  it('refuses a database written by a newer build', () => {
    const db = fresh()
    db.exec(`PRAGMA user_version = ${String(latest + 1)}`)
    expect(() => migrate(db)).toThrow(/newer|version/i)
  })

  it('leaves the version untouched when a step fails', () => {
    const db = fresh()
    // Occupies the name step 1 wants, so its CREATE TABLE throws.
    db.exec('CREATE TABLE prefs (occupied TEXT)')

    expect(() => migrate(db)).toThrow()
    expect(version(db)).toBe(0)
  })

  it('can still be run after a failed attempt is cleared', () => {
    const db = fresh()
    db.exec('CREATE TABLE prefs (occupied TEXT)')
    expect(() => migrate(db)).toThrow()

    db.exec('DROP TABLE prefs')
    expect(migrate(db)).toBe(latest)
    expect(version(db)).toBe(latest)
  })
})
