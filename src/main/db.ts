/**
 * The one database. Everything persistent lives here: preferences now,
 * conversations and provider configuration next.
 *
 * Opened in main and nowhere else. Preload and the renderer never see it.
 */

import { app } from 'electron'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrations.js'

let conn: DatabaseSync | undefined

export function filePath(): string {
  return join(app.getPath('userData'), 'luna.db')
}

/**
 * Opens a database, sets the pragmas we depend on, and brings the schema up to
 * date. Takes a path rather than resolving one, so tests can pass ':memory:'.
 */
export function open(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  // WAL lets a read proceed while a write is in flight. foreign_keys defaults
  // to off in SQLite and has to be set for every connection, not once per file.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

/** The process-wide connection, under userData. Opened on first use. */
export function handle(): DatabaseSync {
  conn ??= open(filePath())
  return conn
}

/** Closes the connection so WAL checkpoints before the process goes away. */
export function close(): void {
  conn?.close()
  conn = undefined
}
