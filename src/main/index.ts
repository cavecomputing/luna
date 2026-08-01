import { BrowserWindow, app, nativeTheme } from 'electron'
import { join } from 'node:path'
import { registerAll } from './ipc/index.js'
import { emit } from './ipc/bus.js'
import * as dock from './dock.js'
import * as menu from './menu.js'
import { registerScheme, serveRenderer } from './protocol.js'
import * as window from './window.js'

// Must happen before 'ready'.
registerScheme()

app.whenReady().then(
  () => {
    serveRenderer(join(import.meta.dirname, '../renderer'))
    dock.setIcon()
    menu.build()
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

// macOS keeps the app running with no windows; the dock icon stays put and
// reopens one. Every other platform treats the app as its window and quits.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (error) => {
  console.error('uncaught exception', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection', reason)
})
