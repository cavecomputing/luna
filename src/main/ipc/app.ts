import { app, type WebContents } from 'electron'
import type { AppInfo } from '../../shared/ipc.js'
import { err, ok, type Result } from '../../shared/result.js'
import { closeCrashedWindow, recoverWindow } from '../window.js'
import { handle } from './bus.js'

type Env = {
  name: string
  version: string
  electron: string
  platform: string
}

/**
 * The handler body is a plain function of its inputs, so tests call it
 * directly without booting Electron.
 */
export function appInfo(env: Env): Result<AppInfo> {
  return ok({
    name: env.name,
    version: env.version,
    electron: env.electron,
    platform: env.platform,
  })
}

type WindowAction = 'recover' | 'close'

export function windowAction(
  sender: WebContents,
  action: WindowAction,
  run: (sender: WebContents) => boolean,
): Result<undefined> {
  if (!run(sender)) {
    return err('app/not-recovering', `cannot ${action} a window outside crash recovery`)
  }
  return ok(undefined)
}

export function register(): void {
  handle('app:info', () =>
    appInfo({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
    }),
  )
  handle('app:recover', (event) => windowAction(event.sender, 'recover', recoverWindow))
  handle('app:close-window', (event) =>
    windowAction(event.sender, 'close', closeCrashedWindow),
  )
}
