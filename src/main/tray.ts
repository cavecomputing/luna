import { Menu, Tray, app, nativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { asset } from './paths.js'
import * as window from './window.js'

/** Module scope on purpose: a garbage-collected Tray vanishes from the menu bar. */
let tray: Tray | undefined

type Actions = {
  onShow: () => void
  onQuit: () => void
}

/**
 * Once the dock icon is hidden this menu is the only way back to a window,
 * and the only way to quit. Both items stay wired for that reason.
 */
export function trayMenu(actions: Actions): MenuItemConstructorOptions[] {
  return [
    { label: 'Show Luna', click: actions.onShow },
    { type: 'separator' },
    { label: 'Quit Luna', click: actions.onQuit },
  ]
}

export function show(): void {
  if (tray !== undefined) return

  // macOS picks up LunaTemplate@2x.png automatically from beside this file.
  const icon = nativeImage.createFromPath(asset('LunaMenuBarIcon', 'LunaTemplate.png'))
  // The `Template` filename suffix already implies this; saying it is clearer.
  icon.setTemplateImage(true)

  const menu = trayMenu({
    onShow: () => {
      window.show()
    },
    onQuit: () => {
      app.quit()
    },
  })

  tray = new Tray(icon)
  tray.setToolTip('Luna')
  tray.setContextMenu(Menu.buildFromTemplate(menu))
}
