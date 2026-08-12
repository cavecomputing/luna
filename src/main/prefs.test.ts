import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultPrefs } from '../shared/prefs.js'
import { open } from './db.js'
import { adoptLegacy, read, write } from './prefs.js'

function db(): DatabaseSync {
  return open(':memory:')
}

const dirs: string[] = []

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'luna-test-'))
  dirs.push(dir)
  return dir
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file)
    return true
  } catch {
    return false
  }
}

afterEach(() => {
  dirs.length = 0
})

describe('read', () => {
  it('returns the defaults for an empty database', () => {
    expect(read(db())).toEqual(defaultPrefs)
  })

  it('falls back for a row holding a value of the wrong type', () => {
    const conn = db()
    conn.exec(`INSERT INTO prefs (key, value) VALUES ('autoTitle', '"yes please"')`)
    expect(read(conn).autoTitle).toBe(defaultPrefs.autoTitle)
  })

  it('falls back for a row whose value is not JSON at all', () => {
    const conn = db()
    conn.exec(`INSERT INTO prefs (key, value) VALUES ('theme', 'not json')`)
    expect(read(conn).theme).toBe(defaultPrefs.theme)
  })

  it('ignores a key that is not a preference', () => {
    const conn = db()
    conn.exec(`INSERT INTO prefs (key, value) VALUES ('apiKey', '"test-not-a-pref"')`)
    expect(Object.keys(read(conn))).toEqual(Object.keys(defaultPrefs))
  })

  it('keeps a good field when a neighbouring row is corrupt', () => {
    const conn = db()
    write(conn, { ...defaultPrefs, stream: false })
    conn.exec(`UPDATE prefs SET value = '{{{' WHERE key = 'theme'`)

    const got = read(conn)
    expect(got.stream).toBe(false)
    expect(got.theme).toBe(defaultPrefs.theme)
  })
})

describe('write', () => {
  it('round-trips every field', () => {
    const conn = db()
    const prefs = {
      theme: 'dark' as const,
      defaultMode: 'expert' as const,
      autoTitle: false,
      stream: false,
      sidebarWidth: 320,
    }

    write(conn, prefs)
    expect(read(conn)).toEqual(prefs)
  })

  it('replaces an earlier value rather than adding a second row', () => {
    const conn = db()
    write(conn, { ...defaultPrefs, theme: 'dark' })
    write(conn, { ...defaultPrefs, theme: 'system' })

    expect(read(conn).theme).toBe('system')
    expect(conn.prepare('SELECT count(*) AS n FROM prefs').get()).toEqual({
      n: Object.keys(defaultPrefs).length,
    })
  })

})

describe('adoptLegacy', () => {
  it('does nothing when there is no legacy file', async () => {
    const dir = await scratch()
    const conn = db()
    expect(await adoptLegacy(conn, join(dir, 'prefs.json'))).toBe(false)
    expect(read(conn)).toEqual(defaultPrefs)
  })

  it('imports the file into the database and removes it', async () => {
    const dir = await scratch()
    const file = join(dir, 'prefs.json')
    await writeFile(file, JSON.stringify({ theme: 'dark', systemPrompt: 'from the file' }))

    const conn = db()
    expect(await adoptLegacy(conn, file)).toBe(true)

    const got = read(conn)
    expect(got.theme).toBe('dark')
    expect(got).not.toHaveProperty('systemPrompt')
    expect(await exists(file)).toBe(false)
  })

  it('validates the file rather than trusting it', async () => {
    const dir = await scratch()
    const file = join(dir, 'prefs.json')
    await writeFile(file, JSON.stringify({ theme: 'neon', apiKey: 'test-should-not-survive' }))

    const conn = db()
    await adoptLegacy(conn, file)

    const got = read(conn)
    expect(got.theme).toBe(defaultPrefs.theme)
    expect(JSON.stringify(got)).not.toContain('test-should-not-survive')
  })

  it('discards the file when the database already holds preferences', async () => {
    const dir = await scratch()
    const file = join(dir, 'prefs.json')
    await writeFile(file, JSON.stringify({ theme: 'dark' }))

    const conn = db()
    write(conn, { ...defaultPrefs, theme: 'system' })

    expect(await adoptLegacy(conn, file)).toBe(false)
    expect(read(conn).theme).toBe('system')
    expect(await exists(file)).toBe(false)
  })

  it('leaves an unparseable file on disk instead of destroying it', async () => {
    const dir = await scratch()
    const file = join(dir, 'prefs.json')
    await writeFile(file, '{ this is not json')

    const conn = db()
    expect(await adoptLegacy(conn, file)).toBe(false)
    expect(await exists(file)).toBe(true)
  })
})
