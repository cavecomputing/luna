import { describe, expect, it } from 'vitest'
import { latest, version } from './migrations.js'
import { open } from './db.js'

describe('open', () => {
  it('returns a migrated database', () => {
    expect(version(open(':memory:'))).toBe(latest)
  })

  it('enforces foreign keys, which SQLite leaves off by default', () => {
    const db = open(':memory:')
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })
})
