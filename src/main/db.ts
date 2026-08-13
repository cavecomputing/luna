/**
 * The one database. Everything persistent lives here: preferences,
 * conversations, attachments, and provider configuration.
 *
 * Opened in main and nowhere else. Preload and the renderer never see it.
 */

import { app } from 'electron'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DatabaseRecoveryStatus } from '../shared/ipc.js'
import { migrate } from './migrations.js'
import {
  closeQuietly,
  createSnapshot,
  eraseDatabase,
  installFresh,
  installRecovery,
  snapshotDue,
  startDatabase,
  type DatabasePaths,
  type RecoveryState,
} from './database-recovery.js'

let conn: DatabaseSync | undefined
let recovery: RecoveryState | undefined
let timer: ReturnType<typeof setTimeout> | undefined

export function filePath(): string {
  return join(app.getPath('userData'), 'luna.db')
}

function paths(): DatabasePaths {
  const root = app.getPath('userData')
  return {
    active: join(root, 'luna.db'),
    backups: join(root, 'backups'),
    recovery: join(root, 'recovery'),
  }
}

/**
 * Opens a database, sets the pragmas we depend on, and brings the schema up to
 * date. Standalone tests and jobs use this instead of the process-wide handle.
 */
export function open(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export async function initialize(now = Date.now()): Promise<DatabaseRecoveryStatus | undefined> {
  const result = await startDatabase(paths(), now)
  if (result.ready) {
    conn = result.db
    recovery = undefined
    return undefined
  }
  recovery = result.recovery
  return recovery.status
}

/** The process-wide connection, available only after successful initialization. */
export function handle(): DatabaseSync {
  if (conn === undefined) throw new Error('database is not initialized')
  return conn
}

/** Whether the connection is usable. Callers outside a request path check this. */
export function ready(): boolean {
  return conn !== undefined
}

export function recoveryStatus(): DatabaseRecoveryStatus | undefined {
  return recovery?.status
}

/**
 * Replaces the database with an empty one and destroys the old files. Unlike
 * `restore` and `startFresh`, which run from the recovery window, this runs
 * from a live app — so it needs a connection rather than a recovery state.
 *
 * Two things hold whether it succeeds or throws: `conn` is always assigned
 * again, so `handle()` is never left permanently broken, and the hourly backup
 * timer is always running. `startBackups` returns early on a live timer, so
 * clearing it here is what makes that restart real.
 *
 * A read arriving during the swap sees `handle()` throw, which `bus.handle`
 * turns into an ipc/handler-threw error for that one call. The window is a few
 * milliseconds and the broadcast that follows repairs the renderer, so there is
 * deliberately no queue or resetting sentinel guarding it.
 */
export async function eraseAll(): Promise<void> {
  if (conn === undefined) throw new Error('database is not initialized')
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  closeQuietly(conn)
  conn = undefined

  try {
    conn = await eraseDatabase(paths())
  } catch (error) {
    conn = open(paths().active)
    throw error
  } finally {
    startBackups()
  }
}

export async function restore(now = Date.now()): Promise<void> {
  if (recovery === undefined) throw new Error('database is not recovering')
  conn = await installRecovery(recovery, now)
  recovery = undefined
}

export async function startFresh(now = Date.now()): Promise<void> {
  if (recovery === undefined) throw new Error('database is not recovering')
  conn = await installFresh(recovery, now)
  recovery = undefined
}

export async function routineBackup(now = Date.now()): Promise<void> {
  if (conn === undefined || !await snapshotDue(paths(), now)) return
  conn.exec('PRAGMA wal_checkpoint(PASSIVE)')
  await createSnapshot(conn, paths(), now)
}

export function startBackups(): void {
  if (timer !== undefined) return
  const run = (): void => {
    timer = setTimeout(() => {
      void routineBackup().catch(() => undefined).finally(run)
    }, 60 * 60 * 1_000)
    timer.unref()
  }
  run()
}

/** Closes the connection so WAL checkpoints before the process goes away. */
export function close(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  conn?.close()
  conn = undefined
}
