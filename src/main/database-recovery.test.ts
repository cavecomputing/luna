import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { latest, migrate } from './migrations.js'
import {
  createSnapshot,
  installFresh,
  installRecovery,
  resumeInstall,
  rotateSnapshots,
  startDatabase,
  type DatabasePaths,
} from './database-recovery.js'

const roots: string[] = []

async function temporary(): Promise<DatabasePaths> {
  const root = await mkdtemp(join(tmpdir(), 'luna-recovery-test-'))
  roots.push(root)
  return {
    active: join(root, 'luna.db'),
    backups: join(root, 'backups'),
    recovery: join(root, 'recovery'),
  }
}

function open(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('database snapshots', () => {
  it('creates one snapshot on clean startup and does not repeat it within a day', async () => {
    const paths = await temporary()
    const now = Date.now()
    const first = await startDatabase(paths, now)
    expect(first.ready).toBe(true)
    if (first.ready) first.db.close()

    const second = await startDatabase(paths, now + 60 * 60 * 1_000)
    expect(second.ready).toBe(true)
    if (second.ready) second.db.close()
    expect((await names(paths.backups)).filter((name) => name.endsWith('.db'))).toHaveLength(1)
  })

  it('keeps the newest five validated snapshots', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    const now = Date.now()
    const source = await createSnapshot(db, paths, now)
    db.close()
    for (let i = 1; i < 6; i += 1) {
      const target = join(paths.backups, `snapshot-copy-${String(i)}.db`)
      await copyFile(source, target)
      const modified = new Date(now + i)
      await utimes(target, modified, modified)
    }
    await rotateSnapshots(paths.backups)
    expect((await names(paths.backups)).filter((name) => name.endsWith('.db'))).toHaveLength(5)
  })

  it('includes committed data that is still in the WAL', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.prepare('INSERT INTO prefs (key, value) VALUES (?, ?)').run('theme', '"dark"')
    const snapshot = await createSnapshot(db, paths, Date.now())
    const copy = new DatabaseSync(snapshot, { readOnly: true })
    expect(copy.prepare('SELECT value FROM prefs WHERE key = ?').get('theme')).toEqual({ value: '"dark"' })
    copy.close()
    db.close()
  })
})

describe('database recovery', () => {
  it('classifies an intact migration failure and preserves a pre-migration backup', async () => {
    const paths = await temporary()
    const db = new DatabaseSync(paths.active)
    db.exec('CREATE TABLE prefs (occupied TEXT)')
    db.close()

    const result = await startDatabase(paths, Date.now())
    expect(result.ready).toBe(false)
    if (!result.ready) expect(result.recovery.status.kind).toBe('migration-failed')
    expect((await names(paths.backups)).some((name) => name.endsWith('.db'))).toBe(true)
  })

  it('refuses a database created by a newer Luna schema', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(`PRAGMA user_version = ${String(latest + 1)}`)
    db.close()

    const result = await startDatabase(paths, Date.now())
    expect(result.ready).toBe(false)
    if (!result.ready) expect(result.recovery.status.kind).toBe('newer-version')
  })

  it('offers the newest valid backup and archives damaged data before restoring', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.prepare('INSERT INTO prefs (key, value) VALUES (?, ?)').run('theme', '"dark"')
    await createSnapshot(db, paths, Date.now())
    db.close()
    await writeFile(paths.active, 'not a sqlite database')

    const result = await startDatabase(paths, Date.now() + 1)
    expect(result.ready).toBe(false)
    if (result.ready) return
    expect(result.recovery.status.kind).toBe('corrupt')
    const restored = await installRecovery(result.recovery, Date.now() + 2)
    expect(restored.prepare('SELECT value FROM prefs WHERE key = ?').get('theme')).toEqual({ value: '"dark"' })
    restored.close()
    expect((await names(paths.recovery)).some((name) => name.startsWith('preserved-'))).toBe(true)
  })

  it('skips an invalid newer backup in favor of an older valid snapshot', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    const good = await createSnapshot(db, paths, Date.now())
    db.close()
    const bad = join(paths.backups, 'snapshot-zzzz.db')
    await writeFile(bad, 'invalid')
    const future = new Date(Date.now() + 60_000)
    await utimes(bad, future, future)
    await writeFile(paths.active, 'invalid active')

    const result = await startDatabase(paths, Date.now())
    expect(result.ready).toBe(false)
    if (!result.ready) {
      expect(result.recovery.status.kind).toBe('corrupt')
      expect(result.recovery.backup).toBe(good)
    }
  })

  it('requires the fresh-start path when all backups are invalid', async () => {
    const paths = await temporary()
    await mkdir(paths.backups, { recursive: true })
    await writeFile(paths.active, 'invalid active')
    await writeFile(join(paths.backups, 'snapshot-invalid.db'), 'invalid backup')

    const result = await startDatabase(paths, Date.now())
    expect(result.ready).toBe(false)
    if (result.ready) return
    expect(result.recovery.status.kind).toBe('corrupt-empty')
    const fresh = await installFresh(result.recovery, Date.now() + 1)
    expect(fresh.prepare('PRAGMA user_version').get()).toEqual({ user_version: latest })
    fresh.close()
    expect((await names(paths.recovery)).some((name) => name.startsWith('preserved-'))).toBe(true)
  })

  it('resumes an install after the active database was already moved', async () => {
    const paths = await temporary()
    const active = open(paths.active)
    active.close()
    const candidate = `${paths.active}.installing`
    const replacement = open(candidate)
    replacement.prepare('INSERT INTO prefs (key, value) VALUES (?, ?)').run('theme', '"light"')
    replacement.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    replacement.close()
    const pending = join(paths.recovery, '.installing')
    await mkdir(pending, { recursive: true })
    await rename(paths.active, join(pending, 'luna.db'))

    expect(await resumeInstall(paths, Date.now())).toBe(true)
    const installed = new DatabaseSync(paths.active, { readOnly: true })
    expect(installed.prepare('SELECT value FROM prefs WHERE key = ?').get('theme')).toEqual({ value: '"light"' })
    installed.close()
    expect(await stat(paths.active)).toBeDefined()
  })

  it('resumes an install committed before preservation began', async () => {
    const paths = await temporary()
    const active = open(paths.active)
    active.close()
    const replacement = open(`${paths.active}.installing`)
    replacement.prepare('INSERT INTO prefs (key, value) VALUES (?, ?)').run('theme', '"dark"')
    replacement.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    replacement.close()

    expect(await resumeInstall(paths, Date.now())).toBe(true)
    const installed = new DatabaseSync(paths.active, { readOnly: true })
    expect(installed.prepare('SELECT value FROM prefs WHERE key = ?').get('theme')).toEqual({ value: '"dark"' })
    installed.close()
    const archives = (await names(paths.recovery)).filter((name) => name.startsWith('preserved-'))
    expect(archives).toHaveLength(1)
    expect(await names(join(paths.recovery, archives[0] ?? 'missing'))).toContain('luna.db')
  })

  it('resumes after the damaged bundle was already archived', async () => {
    const paths = await temporary()
    const active = open(paths.active)
    active.close()
    const replacement = open(`${paths.active}.installing`)
    replacement.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    replacement.close()
    await mkdir(paths.recovery, { recursive: true })
    await rename(paths.active, join(paths.recovery, 'preserved-earlier.db'))

    expect(await resumeInstall(paths, Date.now())).toBe(true)
    const installed = new DatabaseSync(paths.active, { readOnly: true })
    expect(installed.prepare('PRAGMA user_version').get()).toEqual({ user_version: latest })
    installed.close()
  })
})
