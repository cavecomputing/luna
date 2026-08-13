import { chmod, copyFile, mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import type { DatabaseRecoveryStatus } from '../shared/ipc.js'
import { latest, migrate, version } from './migrations.js'
import { object } from './parse.js'

const DAY = 24 * 60 * 60 * 1_000
const KEEP = 5
const SNAPSHOT_PREFIX = 'snapshot-'

export type DatabasePaths = {
  active: string
  backups: string
  recovery: string
}

export type RecoveryState = {
  status: DatabaseRecoveryStatus
  paths: DatabasePaths
  backup?: string
}

export type StartResult =
  | { ready: true; db: DatabaseSync }
  | { ready: false; recovery: RecoveryState }

function configured(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    return db
  } catch (error) {
    closeQuietly(db)
    throw error
  }
}

export function closeQuietly(db: DatabaseSync | undefined): void {
  try {
    db?.close()
  } catch {
    // The recovery path must continue even when SQLite cannot close a damaged file cleanly.
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

function isHealthy(db: DatabaseSync): boolean {
  const rows = db.prepare('PRAGMA integrity_check').all()
  if (rows.length !== 1) return false
  const row = object(rows[0])
  if (row?.integrity_check !== 'ok') return false
  return db.prepare('PRAGMA foreign_key_check').all().length === 0
}

export function validDatabase(file: string): boolean {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file, { readOnly: true })
    return isHealthy(db) && version(db) <= latest
  } catch {
    return false
  } finally {
    closeQuietly(db)
  }
}

async function files(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function snapshots(dir: string): Promise<{ file: string; modified: number }[]> {
  const found: { file: string; modified: number }[] = []
  for (const name of await files(dir)) {
    if (!name.startsWith(SNAPSHOT_PREFIX) || !name.endsWith('.db')) continue
    const file = join(dir, name)
    try {
      found.push({ file, modified: (await stat(file)).mtimeMs })
    } catch {
      // A concurrently removed or unreadable candidate is not usable.
    }
  }
  return found.sort((a, b) => b.modified - a.modified)
}

export async function rotateSnapshots(dir: string): Promise<void> {
  for (const old of (await snapshots(dir)).slice(KEEP)) {
    await rm(old.file, { force: true })
  }
}

function stamp(now: number): string {
  return new Date(now).toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

export async function createSnapshot(
  db: DatabaseSync,
  paths: DatabasePaths,
  now: number,
): Promise<string> {
  await mkdir(paths.backups, { recursive: true, mode: 0o700 })
  const temp = join(paths.backups, '.snapshot.pending')
  const root = join(paths.backups, `${SNAPSHOT_PREFIX}${stamp(now)}`)
  let target = `${root}.db`
  let sequence = 1
  while (await exists(target)) {
    target = `${root}-${String(sequence)}.db`
    sequence += 1
  }
  await rm(temp, { force: true })
  await backup(db, temp, { rate: 1_000_000 })
  await chmod(temp, 0o600)
  if (!validDatabase(temp)) {
    await rm(temp, { force: true })
    throw new Error('database backup failed validation')
  }
  await rename(temp, target)
  const created = new Date(now)
  await utimes(target, created, created)
  await rotateSnapshots(paths.backups)
  return target
}

export async function snapshotDue(paths: DatabasePaths, now: number): Promise<boolean> {
  const newest = (await snapshots(paths.backups))[0]
  return newest === undefined || now - newest.modified >= DAY
}

async function trial(file: string, paths: DatabasePaths): Promise<boolean> {
  const candidate = `${paths.active}.trial`
  await rm(candidate, { force: true })
  try {
    await copyFile(file, candidate)
    const db = configured(candidate)
    try {
      migrate(db)
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      return isHealthy(db)
    } finally {
      closeQuietly(db)
    }
  } catch {
    return false
  } finally {
    await rm(candidate, { force: true })
    await rm(`${candidate}-wal`, { force: true })
    await rm(`${candidate}-shm`, { force: true })
  }
}

async function usableBackup(paths: DatabasePaths): Promise<{ file: string; modified: number } | undefined> {
  for (const candidate of await snapshots(paths.backups)) {
    if (validDatabase(candidate.file) && await trial(candidate.file, paths)) return candidate
  }
  return undefined
}

async function recoveryFor(paths: DatabasePaths): Promise<RecoveryState> {
  let db: DatabaseSync | undefined
  let healthy: boolean
  let currentVersion: number | undefined
  try {
    db = new DatabaseSync(paths.active, { readOnly: true })
    healthy = isHealthy(db)
    currentVersion = version(db)
  } catch {
    healthy = false
  } finally {
    closeQuietly(db)
  }

  if (healthy && currentVersion !== undefined) {
    return {
      paths,
      status: { kind: currentVersion > latest ? 'newer-version' : 'migration-failed' },
    }
  }

  const candidate = await usableBackup(paths)
  if (candidate === undefined) return { paths, status: { kind: 'corrupt-empty' } }
  return {
    paths,
    backup: candidate.file,
    status: { kind: 'corrupt', backupCreatedAt: candidate.modified },
  }
}

async function uniqueArchive(paths: DatabasePaths, now: number): Promise<string> {
  await mkdir(paths.recovery, { recursive: true, mode: 0o700 })
  const base = join(paths.recovery, `preserved-${stamp(now)}`)
  let candidate = base
  let sequence = 1
  while (await exists(candidate)) {
    candidate = `${base}-${String(sequence)}`
    sequence += 1
  }
  return candidate
}

async function moveIfPresent(source: string, target: string): Promise<void> {
  if (await exists(source)) await rename(source, target)
}

/** Finishes an install whose candidate rename is the operation's durable commit point. */
export async function resumeInstall(paths: DatabasePaths, now: number): Promise<boolean> {
  const installing = `${paths.active}.installing`
  if (!await exists(installing)) return false

  const pending = join(paths.recovery, '.installing')
  await mkdir(pending, { recursive: true, mode: 0o700 })
  await moveIfPresent(paths.active, join(pending, basename(paths.active)))
  await moveIfPresent(`${paths.active}-wal`, join(pending, `${basename(paths.active)}-wal`))
  await moveIfPresent(`${paths.active}-shm`, join(pending, `${basename(paths.active)}-shm`))

  const archived = await uniqueArchive(paths, now)
  await rename(pending, archived)
  await rename(installing, paths.active)
  return true
}

async function commitCandidate(paths: DatabasePaths, candidate: string, now: number): Promise<void> {
  const installing = `${paths.active}.installing`
  await rm(installing, { force: true })
  await rename(candidate, installing)
  await resumeInstall(paths, now)
}

async function prepareCandidate(paths: DatabasePaths, source?: string): Promise<string> {
  const candidate = `${paths.active}.candidate`
  await rm(candidate, { force: true })
  if (source !== undefined) await copyFile(source, candidate)
  const db = configured(candidate)
  await chmod(candidate, 0o600)
  try {
    migrate(db)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    if (!isHealthy(db)) throw new Error('recovery candidate failed validation')
  } finally {
    closeQuietly(db)
  }
  return candidate
}

export async function installRecovery(state: RecoveryState, now: number): Promise<DatabaseSync> {
  if (state.status.kind !== 'corrupt' || state.backup === undefined) {
    throw new Error('no database backup is available')
  }
  const candidate = await prepareCandidate(state.paths, state.backup)
  await commitCandidate(state.paths, candidate, now)
  return openReady(state.paths.active)
}

export async function installFresh(state: RecoveryState, now: number): Promise<DatabaseSync> {
  if (state.status.kind !== 'corrupt-empty') throw new Error('fresh start is not allowed')
  const candidate = await prepareCandidate(state.paths)
  await commitCandidate(state.paths, candidate, now)
  return openReady(state.paths.active)
}

function openReady(file: string): DatabaseSync {
  const db = configured(file)
  migrate(db)
  return db
}

/**
 * Removes a file, retrying briefly. On Windows an attachment worker still
 * holding the database open turns an unlink into EBUSY; on POSIX the retries
 * never happen and cost nothing.
 */
async function erase(file: string): Promise<void> {
  await rm(file, { force: true, maxRetries: 5, retryDelay: 100 })
}

/**
 * Destroys the active database and everything that could reconstruct it, then
 * installs an empty migrated one. Nothing is preserved — this is the privacy
 * delete, not the repair path, so it deliberately avoids `commitCandidate` and
 * the `.installing` file: `resumeInstall` archives the old database under
 * `recovery/` so the next launch can get it back, which is the opposite of what
 * is wanted here. Callers must have closed their handle first.
 *
 * The replacement is built before anything is removed. That first step is the
 * only one that fails for an ordinary reason — a full disk, a migration bug —
 * and failing there leaves every byte of the user's data untouched.
 */
export async function eraseDatabase(paths: DatabasePaths): Promise<DatabaseSync> {
  const candidate = await prepareCandidate(paths)

  // Snapshots and preserved archives are full copies of the conversations being
  // deleted. Leaving either behind would make this a rename, not a delete.
  await rm(paths.backups, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(paths.recovery, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

  await erase(paths.active)
  await erase(`${paths.active}-wal`)
  await erase(`${paths.active}-shm`)

  await rename(candidate, paths.active)
  return openReady(paths.active)
}

export async function startDatabase(paths: DatabasePaths, now: number): Promise<StartResult> {
  await resumeInstall(paths, now)
  const hadDatabase = await exists(paths.active)
  let db: DatabaseSync | undefined
  try {
    db = configured(paths.active)
    const from = version(db)
    if (hadDatabase && from < latest) {
      if (!isHealthy(db)) throw new Error('database failed integrity check')
      await createSnapshot(db, paths, now)
    }
    migrate(db)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    if (!hadDatabase || from < latest || await snapshotDue(paths, now)) {
      try {
        await createSnapshot(db, paths, now + (from < latest && hadDatabase ? 1 : 0))
      } catch {
        // A routine or post-migration backup failure must not hide a healthy database.
      }
    }
    return { ready: true, db }
  } catch {
    closeQuietly(db)
    return { ready: false, recovery: await recoveryFor(paths) }
  }
}
