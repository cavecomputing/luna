import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  truncate,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { latest, migrate } from './migrations.js'
import {
  createSnapshot,
  eraseDatabase,
  installFresh,
  installRecovery,
  resumeInstall,
  rotateSnapshots,
  snapshotDue,
  startDatabase,
  validDatabase,
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

describe('eraseDatabase', () => {
  it('does not leave an installing file for the next launch to archive', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.close()

    const replacement = await eraseDatabase(paths)
    replacement.close()

    // The repair path preserves the old bundle under recovery/. A privacy
    // delete must never hand it back, so nothing may be left to resume.
    expect(await resumeInstall(paths, Date.now())).toBe(false)
    expect(await names(paths.recovery)).toEqual([])
  })

  it('replaces the database with an empty migrated one', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec(`INSERT INTO prefs (key, value) VALUES ('theme', '"gruvbox-dark"')`)
    db.close()

    const replacement = await eraseDatabase(paths)

    expect(replacement.prepare('PRAGMA user_version').get()).toEqual({ user_version: latest })
    expect(replacement.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 0 })
    expect(replacement.prepare('SELECT count(*) AS n FROM prefs').get()).toEqual({ n: 0 })
    // A fresh install seeds these, so a reset lands on the same state.
    expect(replacement.prepare('SELECT count(*) AS n FROM model_slots').get()).toEqual({ n: 2 })
    expect(replacement.prepare('SELECT count(*) AS n FROM providers').get()).toEqual({ n: 1 })
    replacement.close()
  })

  it('removes every snapshot, including a partial one', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    await createSnapshot(db, paths, Date.now())
    db.close()
    await writeFile(join(paths.backups, '.snapshot.pending'), 'partial conversation data')

    const replacement = await eraseDatabase(paths)
    replacement.close()

    expect(await names(paths.backups)).toEqual([])
  })

  it('removes preserved archives left by an earlier recovery', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.close()
    await mkdir(join(paths.recovery, 'preserved-earlier'), { recursive: true })
    await writeFile(join(paths.recovery, 'preserved-earlier', 'luna.db'), 'old conversations')

    const replacement = await eraseDatabase(paths)
    replacement.close()

    expect(await names(paths.recovery)).toEqual([])
  })

  it('leaves no write-ahead log or shared memory file behind', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.close()

    const replacement = await eraseDatabase(paths)
    replacement.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    replacement.close()

    const remaining = await names(dirname(paths.active))
    expect(remaining.filter((name) => name.startsWith('luna.db-'))).toEqual([])
  })

  it('leaves the database intact when the replacement cannot be built', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    // A directory where the candidate file has to go: prepareCandidate fails.
    await mkdir(`${paths.active}.candidate`, { recursive: true })
    await writeFile(join(`${paths.active}.candidate`, 'blocker'), 'x')

    await expect(eraseDatabase(paths)).rejects.toThrow()

    const survivor = new DatabaseSync(paths.active, { readOnly: true })
    expect(survivor.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 1 })
    survivor.close()
  })
})

// Adversarial coverage: the states a user actually arrives in after a crash,
// a full disk, a clock correction, or a file-sync tool truncating a file.
describe('database recovery under attack', () => {
  it('refuses a truncated database instead of silently starting empty', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    await createSnapshot(db, paths, Date.now() - 5_000)
    db.close()
    // A sync client, a full disk, or a power cut mid-write leaves this.
    await truncate(paths.active, 0)

    const result = await startDatabase(paths, Date.now())

    // Opening empty would present a healthy-looking app with every conversation
    // gone, and would then snapshot the emptiness over the good backups.
    expect(result.ready).toBe(false)
    if (result.ready) return
    expect(result.recovery.status.kind).toBe('corrupt')

    const restored = await installRecovery(result.recovery, Date.now() + 1)
    expect(restored.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 1 })
    restored.close()
  }, 20_000)

  it('does not let an emptied database overwrite the snapshot ring', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    await createSnapshot(db, paths, Date.now() - 5_000)
    db.close()
    await truncate(paths.active, 0)

    for (let i = 0; i < 3; i += 1) {
      const result = await startDatabase(paths, Date.now() + i)
      if (result.ready) result.db.close()
    }

    const kept = (await names(paths.backups)).filter((name) => name.endsWith('.db'))
    expect(kept.length).toBeGreaterThan(0)
    for (const name of kept) {
      const snapshot = new DatabaseSync(join(paths.backups, name), { readOnly: true })
      expect(snapshot.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 1 })
      snapshot.close()
    }
  }, 20_000)

  it('keeps the newest valid snapshot when newer ones are damaged', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    const good = await createSnapshot(db, paths, Date.now() - 100_000)
    db.close()
    // Five later snapshots that cannot be restored from. Pruning purely by age
    // would evict the one file that still holds the user's conversations.
    for (let i = 1; i <= 5; i += 1) {
      const bad = join(paths.backups, `snapshot-damaged-${String(i)}.db`)
      await writeFile(bad, 'garbage')
      const modified = new Date(Date.now() + i * 1_000)
      await utimes(bad, modified, modified)
    }

    await rotateSnapshots(paths.backups)

    expect(await names(paths.backups)).toContain(good.split('/').pop())
  })

  it('keeps a snapshot written by a newer Luna instead of pruning it', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    const current = await createSnapshot(db, paths, Date.now())
    db.close()
    const ahead = join(paths.backups, 'snapshot-from-a-newer-build.db')
    await copyFile(current, ahead)
    const upgraded = new DatabaseSync(ahead)
    upgraded.exec(`PRAGMA user_version = ${String(latest + 1)}`)
    upgraded.close()
    await rm(`${ahead}-wal`, { force: true })
    await rm(`${ahead}-shm`, { force: true })

    await rotateSnapshots(paths.backups)

    // This build cannot restore it, but reinstalling the version that wrote it
    // can. Pruning it would destroy data a downgrade was supposed to leave alone.
    expect(await names(paths.backups)).toContain('snapshot-from-a-newer-build.db')
  })

  it('takes a backup again after the clock is corrected backwards', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    const now = Date.now()
    const snapshot = await createSnapshot(db, paths, now)
    db.close()
    // A skewed clock, an NTP correction, or a restored file-system backup dates
    // a snapshot in the future. Age arithmetic then never reaches a day.
    const future = new Date(now + 365 * 24 * 60 * 60 * 1_000)
    await utimes(snapshot, future, future)

    expect(await snapshotDue(paths, now)).toBe(true)
  })

  it('leaves no scratch copy of the database behind after a snapshot', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    await createSnapshot(db, paths, Date.now())
    db.close()

    expect((await names(paths.backups)).filter((name) => name.startsWith('.snapshot'))).toEqual([])
  })

  it('reports a healthy database as ready when the backup directory is read-only', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.close()
    await mkdir(paths.backups, { recursive: true })
    await chmod(paths.backups, 0o500)

    const result = await startDatabase(paths, Date.now())
    await chmod(paths.backups, 0o700)

    // A backup that cannot be written is not a reason to show a recovery window
    // over a database that opens and passes its integrity check.
    expect(result.ready).toBe(true)
    if (result.ready) result.db.close()
  })

  it('refuses a backup written by a newer schema rather than restoring it', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    const snapshot = await createSnapshot(db, paths, Date.now() - 5_000)
    db.close()
    const ahead = new DatabaseSync(snapshot)
    ahead.exec(`PRAGMA user_version = ${String(latest + 1)}`)
    ahead.close()
    await writeFile(paths.active, 'not a sqlite database')

    expect(validDatabase(snapshot)).toBe(false)
    const result = await startDatabase(paths, Date.now())
    expect(result.ready).toBe(false)
    if (!result.ready) expect(result.recovery.status.kind).toBe('corrupt-empty')
  })

  it('survives a garbage write-ahead log beside an intact database', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    await writeFile(`${paths.active}-wal`, Buffer.alloc(4_096, 0x41))

    const result = await startDatabase(paths, Date.now())
    expect(result.ready).toBe(true)
    if (result.ready) {
      expect(result.db.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 1 })
      result.db.close()
    }
  })

  it('does not resume an install from a candidate that was never committed', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    // A crash between prepareCandidate and commitCandidate. The candidate is not
    // the commit point, so the live database must win.
    const candidate = open(`${paths.active}.candidate`)
    candidate.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    candidate.close()

    expect(await resumeInstall(paths, Date.now())).toBe(false)
    const result = await startDatabase(paths, Date.now())
    expect(result.ready).toBe(true)
    if (result.ready) {
      expect(result.db.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 1 })
      result.db.close()
    }
  })

  it('preserves both bundles when an install is interrupted twice', async () => {
    const paths = await temporary()
    const first = open(paths.active)
    first.exec(`INSERT INTO prefs (key, value) VALUES ('theme', '"first"')`)
    first.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    first.close()
    const replacement = open(`${paths.active}.installing`)
    replacement.exec(`INSERT INTO prefs (key, value) VALUES ('theme', '"second"')`)
    replacement.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    replacement.close()

    expect(await resumeInstall(paths, Date.now())).toBe(true)

    const again = open(`${paths.active}.installing`)
    again.exec(`INSERT INTO prefs (key, value) VALUES ('theme', '"third"')`)
    again.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    again.close()
    expect(await resumeInstall(paths, Date.now() + 1)).toBe(true)

    const installed = new DatabaseSync(paths.active, { readOnly: true })
    expect(installed.prepare('SELECT value FROM prefs WHERE key = ?').get('theme')).toEqual({ value: '"third"' })
    installed.close()
    // Neither interrupted generation may be silently dropped on the floor.
    expect((await names(paths.recovery)).filter((name) => name.startsWith('preserved-'))).toHaveLength(2)
  })

  it('restores from an older snapshot when the newest is truncated', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const older = await createSnapshot(db, paths, Date.now() - 100_000)
    db.close()
    const newer = join(paths.backups, 'snapshot-newer.db')
    await copyFile(older, newer)
    await truncate(newer, 0)
    const modified = new Date(Date.now())
    await utimes(newer, modified, modified)
    await writeFile(paths.active, 'not a sqlite database')

    const result = await startDatabase(paths, Date.now() + 1)
    expect(result.ready).toBe(false)
    if (result.ready) return
    expect(result.recovery.backup).toBe(older)
    const restored = await installRecovery(result.recovery, Date.now() + 2)
    expect(restored.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 1 })
    restored.close()
  }, 20_000)
})

describe('startup scratch sweep', () => {
  it('removes the working copies a crashed recovery left on disk', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    // trial() and prepareCandidate() clear these in a finally. A crash does not.
    await copyFile(paths.active, `${paths.active}.trial`)
    await copyFile(paths.active, `${paths.active}.candidate`)
    await writeFile(`${paths.active}.trial-wal`, 'stray write-ahead log')

    const result = await startDatabase(paths, Date.now())
    expect(result.ready).toBe(true)
    if (result.ready) result.db.close()

    const remaining = (await names(dirname(paths.active)))
      .filter((name) => name.startsWith('luna.db.'))
    expect(remaining).toEqual([])
  })

  it('opens normally when a leftover cannot be removed', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    // A non-empty directory under the scratch name: rm refuses it.
    await mkdir(`${paths.active}.trial`, { recursive: true })
    await writeFile(join(`${paths.active}.trial`, 'blocker'), 'x')

    const result = await startDatabase(paths, Date.now())

    // Failing to tidy up must never route a healthy database to recovery.
    expect(result.ready).toBe(true)
    if (result.ready) {
      expect(result.db.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 1 })
      result.db.close()
    }
  })

  it('still finishes an interrupted install before sweeping', async () => {
    const paths = await temporary()
    const active = open(paths.active)
    active.close()
    const replacement = open(`${paths.active}.installing`)
    replacement.exec(`INSERT INTO prefs (key, value) VALUES ('theme', '"restored"')`)
    replacement.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    replacement.close()
    await copyFile(paths.active, `${paths.active}.trial`)

    const result = await startDatabase(paths, Date.now())
    expect(result.ready).toBe(true)
    if (result.ready) {
      // The commit point wins; only the abandoned scratch is discarded.
      expect(result.db.prepare('SELECT value FROM prefs WHERE key = ?').get('theme'))
        .toEqual({ value: '"restored"' })
      result.db.close()
    }
    expect(await names(dirname(paths.active))).not.toContain('luna.db.trial')
  })
})

describe('eraseDatabase under attack', () => {
  it('destroys scratch copies left behind by an interrupted recovery', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec(
      `INSERT INTO messages (id, conversation_id, role, text, status, created_at, ordinal)
       VALUES ('msg-1', 'chat-1', 'user', 'synthetic message text', 'complete', 1, 0)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    // trial() and prepareCandidate() both write full copies of the database next
    // to it. A crash leaves them; a privacy delete that misses them is a rename.
    await copyFile(paths.active, `${paths.active}.trial`)
    await copyFile(paths.active, `${paths.active}.candidate`)
    await writeFile(`${paths.active}.trial-wal`, 'stray write-ahead log')

    const replacement = await eraseDatabase(paths)
    replacement.close()

    const remaining = (await names(dirname(paths.active)))
      .filter((name) => name.startsWith('luna.db') && name !== 'luna.db')
    expect(remaining).toEqual([])
  })

  it('leaves the database intact when the backup directory cannot be removed', async () => {
    const paths = await temporary()
    const db = open(paths.active)
    db.exec(
      `INSERT INTO conversations (id, title, mode, pinned, created_at, updated_at)
       VALUES ('chat-1', 'Synthetic', 'fast', 0, 1, 1)`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    await mkdir(join(paths.backups, 'nested'), { recursive: true })
    await writeFile(join(paths.backups, 'nested', 'snapshot-x.db'), 'data')
    await chmod(join(paths.backups, 'nested'), 0o500)

    const outcome = await eraseDatabase(paths).then(
      (replacement) => {
        replacement.close()
        return 'erased' as const
      },
      () => 'threw' as const,
    )
    await chmod(join(paths.backups, 'nested'), 0o700)

    // Either outcome is defensible; a half-erased database that still opens with
    // the user's conversations in it is not.
    if (outcome === 'threw') {
      const survivor = new DatabaseSync(paths.active, { readOnly: true })
      expect(survivor.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 1 })
      survivor.close()
    } else {
      const replaced = new DatabaseSync(paths.active, { readOnly: true })
      expect(replaced.prepare('SELECT count(*) AS n FROM conversations').get()).toEqual({ n: 0 })
      replaced.close()
    }
  })
})
