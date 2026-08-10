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
      ALTER TABLE messages DROP COLUMN reasoning;
      ALTER TABLE messages DROP COLUMN provider_id;`)

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
      (id, title, icon, mode, pinned, created_at, updated_at)
      VALUES ('chat-1', 'Chat', 'spark', 'fast', 0, 1, 1);
      INSERT INTO messages
      (id, conversation_id, role, text, status, created_at, ordinal)
      VALUES ('message-1', 'chat-1', 'assistant', 'Answer', 'complete', 1, 0);
      PRAGMA user_version = 4;
      ALTER TABLE messages DROP COLUMN reasoning;`)

    migrate(db)

    expect(db.prepare('SELECT text, reasoning FROM messages').get()).toEqual({
      text: 'Answer',
      reasoning: '',
    })
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
