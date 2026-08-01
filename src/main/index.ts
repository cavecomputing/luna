import { BrowserWindow, app, nativeTheme } from 'electron'
import { join } from 'node:path'
import { registerAll } from './ipc/index.js'
import { emit } from './ipc/bus.js'
import * as menu from './menu.js'
import { asset } from './paths.js'
import { registerScheme, serveRenderer } from './protocol.js'
import * as tray from './tray.js'
import * as window from './window.js'

// Must happen before 'ready'.
registerScheme()

app.whenReady().then(
  () => {
    serveRenderer(join(import.meta.dirname, '../renderer'))

    // Dev runs from the Electron binary, so the dock shows Electron's icon.
    // A packaged build takes it from the bundle and needs no override.
    if (!app.isPackaged) app.dock?.setIcon(asset('LunaAppIcon', 'icon.png'))

    menu.build()
    tray.show()
    registerAll()
    window.create()

    nativeTheme.on('updated', () => {
      for (const win of BrowserWindow.getAllWindows()) {
        emit(win.webContents, 'theme:changed', { dark: nativeTheme.shouldUseDarkColors })
      }
    })

    // macOS: clicking the dock icon with no windows open reopens one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) window.create()
    })
  },
  (error: unknown) => {
    console.error('failed to start', error)
    app.quit()
  },
)

// macOS keeps the app running with no windows. Every other platform quits.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (error) => {
  console.error('uncaught exception', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection', reason)
})
