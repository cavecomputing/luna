import { Menu, Tray, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { asset } from './paths.js'

/** Module scope on purpose: a garbage-collected Tray vanishes from the menu bar. */
let tray: Tray | undefined

/**
 * Placeholder menu. Nothing is wired up yet, so the one item is disabled
 * rather than clickable-but-dead.
 */
export function trayMenu(): MenuItemConstructorOptions[] {
  return [{ label: 'WIP', enabled: false }]
}

export function show(): void {
  if (tray !== undefined) return

  // macOS picks up LunaTemplate@2x.png automatically from beside this file.
  const icon = nativeImage.createFromPath(asset('LunaMenuBarIcon', 'LunaTemplate.png'))
  // The `Template` filename suffix already implies this; saying it is clearer.
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('Luna')
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu()))
}
