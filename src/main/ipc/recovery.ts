import { app, type WebContents } from 'electron'
import type { DatabaseRecoveryStatus } from '../../shared/ipc.js'
import { err, ok, type Result } from '../../shared/result.js'
import * as db from '../db.js'
import * as recoveryWindow from '../recovery-window.js'
import { handle } from './bus.js'

let onReady: (() => Promise<void>) | undefined
let working = false

export function setReady(fn: () => Promise<void>): void {
  onReady = fn
}

export function recoveryStatus(sender: WebContents): Result<DatabaseRecoveryStatus> {
  const status = db.recoveryStatus()
  if (!recoveryWindow.owns(sender) || status === undefined) {
    return err('recovery/not-active', 'database recovery is not active')
  }
  return ok(status)
}

type RecoveryAction = 'restore' | 'retry' | 'start-fresh'

export async function runAction(
  sender: WebContents,
  action: RecoveryAction,
): Promise<Result<undefined>> {
  if (!recoveryWindow.owns(sender) || db.recoveryStatus() === undefined) {
    return err('recovery/not-active', 'database recovery is not active')
  }
  if (working) return err('recovery/busy', 'database recovery is already running')
  working = true
  try {
    if (action === 'restore') await db.restore()
    else if (action === 'start-fresh') await db.startFresh()
    else {
      const status = await db.initialize()
      if (status !== undefined) return err('recovery/retry-failed', 'database still cannot open')
    }
    await onReady?.()
    recoveryWindow.finish()
    return ok(undefined)
  } catch {
    return err('recovery/action-failed', `database ${action} failed`)
  } finally {
    working = false
  }
}

export function quit(sender: WebContents): Result<undefined> {
  if (!recoveryWindow.owns(sender)) {
    return err('recovery/not-active', 'database recovery is not active')
  }
  setTimeout(() => {
    app.quit()
  }, 0)
  return ok(undefined)
}

export function register(): void {
  handle('recovery:status', (event) => recoveryStatus(event.sender))
  handle('recovery:restore', (event) => runAction(event.sender, 'restore'))
  handle('recovery:retry', (event) => runAction(event.sender, 'retry'))
  handle('recovery:start-fresh', (event) => runAction(event.sender, 'start-fresh'))
  handle('recovery:quit', (event) => quit(event.sender))
}
