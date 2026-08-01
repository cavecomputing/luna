import * as appIpc from './app.js'
import * as prefsIpc from './prefs.js'
import * as settingsIpc from './settings.js'

/** Every IPC domain registers here. One line per new domain file. */
export function registerAll(): void {
  appIpc.register()
  prefsIpc.register()
  settingsIpc.register()
}
