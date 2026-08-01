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

  it('does nothing to an already migrated database', () => {
    const db = fresh()
    migrate(db)
    db.exec("INSERT INTO prefs (key, value) VALUES ('theme', '\"dark\"')")

    migrate(db)

    // A step re-run would have thrown on CREATE TABLE, and the row would be gone.
    expect(version(db)).toBe(latest)
    expect(db.prepare('SELECT count(*) AS n FROM prefs').get()).toEqual({ n: 1 })
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
