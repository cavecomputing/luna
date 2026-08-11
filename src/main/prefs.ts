/**
 * Preference storage. One row per field in the `prefs` table, JSON-encoded so
 * strings and booleans both round-trip.
 *
 * There is no cache. A single-row SQLite read takes microseconds, and a cache
 * is one more place a value can go stale — see "Settings apply immediately" in
 * CLAUDE.md.
 */

import { app, nativeTheme } from 'electron'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { parsePrefs, type Prefs } from '../shared/prefs.js'
import * as db from './db.js'
import { object } from './parse.js'

/**
 * A row is unknown until proven otherwise. One we can't read is dropped, which
 * leaves that field at its default — the same result as a missing row.
 */
function entry(row: unknown): [string, unknown] | undefined {
  const cell = object(row)
  if (cell === undefined || typeof cell.key !== 'string' || typeof cell.value !== 'string') {
    return undefined
  }

  try {
    return [cell.key, JSON.parse(cell.value)]
  } catch {
    return undefined
  }
}

export function read(conn: DatabaseSync): Prefs {
  const raw: Record<string, unknown> = {}

  for (const row of conn.prepare('SELECT key, value FROM prefs').all()) {
    const pair = entry(row)
    if (pair !== undefined) raw[pair[0]] = pair[1]
  }

  return parsePrefs(raw)
}

/** Writes every field as one transaction, so a failure leaves the old set intact. */
export function write(conn: DatabaseSync, prefs: Prefs): Prefs {
  const upsert = conn.prepare(
    'INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )

  conn.exec('BEGIN')
  try {
    for (const [key, value] of Object.entries(prefs)) {
      upsert.run(key, JSON.stringify(value))
    }
    conn.exec('COMMIT')
  } catch (error) {
    conn.exec('ROLLBACK')
    throw error
  }

  return prefs
}

function count(conn: DatabaseSync): number {
  const cell = object(conn.prepare('SELECT count(*) AS n FROM prefs').get())
  return typeof cell?.n === 'number' ? cell.n : 0
}

/**
 * prefs.json predates the database. Fold it in once and remove it, so a setting
 * never has two homes.
 *
 * Rows already in the database win — if there are any, the file is stale by
 * definition. A file we can't parse is left on disk rather than destroyed;
 * defaults apply until someone looks at it.
 *
 * Returns true only when the file's contents were adopted.
 */
export async function adoptLegacy(conn: DatabaseSync, file: string): Promise<boolean> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return false // Absent is the normal case, on every run after the first.
  }

  if (count(conn) > 0) {
    await unlink(file)
    return false
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }

  write(conn, parsePrefs(parsed))
  await unlink(file)
  return true
}

export function legacyPath(): string {
  return join(app.getPath('userData'), 'prefs.json')
}

export function load(): Prefs {
  return read(db.handle())
}

export function save(prefs: Prefs): Prefs {
  return write(db.handle(), prefs)
}

/** Push the stored theme into Chromium so prefers-color-scheme follows it. */
export function applyTheme(prefs: Prefs): void {
  nativeTheme.themeSource = prefs.theme
}
