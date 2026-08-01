import { app } from 'electron'
import { join } from 'node:path'

/**
 * Assets sit beside the source in dev and inside the bundle once packaged.
 * Kept a plain function of its inputs so tests don't need Electron.
 */
export function assetRoot(packaged: boolean, mainDir: string, resources: string): string {
  return packaged ? join(resources, 'assets') : join(mainDir, '../../assets')
}

/** Absolute path to a file under assets/, correct in dev and when packaged. */
export function asset(...parts: string[]): string {
  const root = assetRoot(app.isPackaged, import.meta.dirname, process.resourcesPath)
  return join(root, ...parts)
}
