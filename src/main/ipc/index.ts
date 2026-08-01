import * as appIpc from './app.js'

/** Every IPC domain registers here. One line per new domain file. */
export function registerAll(): void {
  appIpc.register()
}
