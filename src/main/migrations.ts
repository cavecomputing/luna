/**
 * Schema migrations: ordered, numbered, and applied in one direction only.
 *
 * Step N brings the database to `user_version` N+1. A step that has shipped is
 * frozen — editing it would leave every existing database on the old shape
 * while its version number claims otherwise. Add a new step instead.
 */

import type { DatabaseSync } from 'node:sqlite'

const steps: readonly string[] = [
  `CREATE TABLE prefs (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   ) STRICT;`,
  `CREATE TABLE providers (
     id           TEXT PRIMARY KEY,
     name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
     base_url     TEXT NOT NULL,
     api          TEXT NOT NULL CHECK (api IN ('responses', 'chat-completions')),
     organization TEXT NOT NULL DEFAULT '',
     project      TEXT NOT NULL DEFAULT ''
   ) STRICT;

   CREATE TABLE model_slots (
     slot        TEXT PRIMARY KEY CHECK (slot IN ('fast', 'expert')),
     provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
     model       TEXT NOT NULL DEFAULT ''
   ) STRICT;

   INSERT INTO providers (id, name, base_url, api)
   VALUES ('openai', 'OpenAI', 'https://api.openai.com/v1', 'responses');

   INSERT INTO model_slots (slot, provider_id, model)
   VALUES ('fast', 'openai', ''), ('expert', 'openai', '');`,
]

/** The version a fully migrated database reports. */
export const latest = steps.length

export function version(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get()
  if (typeof row !== 'object' || row === null) return 0
  const cell: Record<string, unknown> = { ...row }
  return typeof cell.user_version === 'number' ? cell.user_version : 0
}

/**
 * Applies every step this database has not seen yet.
 *
 * Each step commits with its own version bump. SQLite keeps `user_version` in
 * the file header and rolls it back with the transaction, so an interrupted
 * migration leaves a database that is behind rather than half-applied.
 */
export function migrate(db: DatabaseSync): number {
  const from = version(db)

  if (from > latest) {
    // Written by a newer build. Guessing at a schema we don't know would
    // corrupt it, so refuse and let startup fail loudly.
    throw new Error(`database is at version ${String(from)}, this build knows ${String(latest)}`)
  }

  for (const [i, sql] of steps.entries()) {
    if (i < from) continue

    db.exec('BEGIN')
    try {
      db.exec(sql)
      // PRAGMA takes a literal, not a bound parameter. `i` is an index over our
      // own array and never comes from outside.
      db.exec(`PRAGMA user_version = ${String(i + 1)}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return latest
}
