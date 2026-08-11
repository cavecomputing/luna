import { BrowserWindow, app, nativeTheme } from 'electron'
import { join } from 'node:path'
import * as chats from './chats.js'
import { registerAll } from './ipc/index.js'
import { coordinator } from './ipc/chat.js'
import { emit } from './ipc/bus.js'
import * as db from './db.js'
import * as dock from './dock.js'
import * as menu from './menu.js'
import * as prefs from './prefs.js'
import { registerScheme, serveRenderer } from './protocol.js'
import * as window from './window.js'

// Must happen before 'ready'.
registerScheme()

app.whenReady().then(
  async () => {
    serveRenderer(join(import.meta.dirname, '../renderer'))
    dock.setIcon()

    // Opens and migrates. No window exists yet, so a slow migration has nothing
    // to block, and a failure lands in the rejection handler below.
    const conn = db.handle()
    await prefs.adoptLegacy(conn, prefs.legacyPath())
    chats.recoverInterrupted(conn)

    // Theme comes from prefs, which default to light. Applied before the first
    // window so there is no flash of the wrong appearance.
    prefs.applyTheme(prefs.load())

    menu.build()
    registerAll()
    window.create()

    nativeTheme.on('updated', () => {
      for (const win of BrowserWindow.getAllWindows()) {
        window.updateChrome(win)
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

app.on('before-quit', () => {
  window.beginQuit()
})

app.on('child-process-gone', (_event, details) => {
  console.error('child process gone', details.type, details.reason, details.exitCode)
})

// Checkpoints the WAL, so the next launch doesn't replay one.
app.on('will-quit', () => {
  coordinator.stopAll()
  db.close()
})

process.on('uncaughtException', (error) => {
  console.error('uncaught exception', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection', reason)
})
