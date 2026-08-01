import { app } from 'electron'
import { asset } from './paths.js'

/**
 * Dev runs from the Electron binary, which carries Electron's own icon.
 * A packaged build takes the icon from its bundle and needs no override.
 */
export function setIcon(): void {
  if (!app.isPackaged) app.dock?.setIcon(asset('LunaAppIcon', 'icon.png'))
}
