import { app } from 'electron'
import type { AppInfo } from '../../shared/ipc.js'
import { ok, type Result } from '../../shared/result.js'
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

export function register(): void {
  handle('app:info', () =>
    appInfo({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
    }),
  )
}
