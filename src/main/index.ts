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
import * as recoveryIpc from './ipc/recovery.js'
import * as recoveryWindow from './recovery-window.js'
import * as window from './window.js'

let quitting = false
let launched = false

async function launch(): Promise<void> {
  if (launched) return
  const conn = db.handle()
  await prefs.adoptLegacy(conn, prefs.legacyPath())
  chats.recoverInterrupted(conn)

  prefs.applyTheme(prefs.load())
  menu.build()
  registerAll()
  db.startBackups()
  launched = true
  window.create()
}

async function ready(): Promise<void> {
  serveRenderer(join(import.meta.dirname, '../renderer'))
  dock.setIcon()
  recoveryIpc.setReady(launch)
  recoveryIpc.register()

  nativeTheme.on('updated', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      window.updateChrome(win)
      emit(win.webContents, 'theme:changed', { dark: nativeTheme.shouldUseDarkColors })
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length !== 0) return
    if (launched) window.create()
    else if (db.recoveryStatus() !== undefined) recoveryWindow.show()
  })

  const recovery = await db.initialize()
  if (recovery !== undefined) {
    recoveryWindow.show()
    return
  }
  await launch()
}

function failed(error: unknown): void {
  console.error('failed to start', error)
  app.quit()
}

function start(): void {
  // Must happen before 'ready'.
  registerScheme()
  app.on('second-instance', () => {
    if (!quitting && app.isReady()) {
      if (launched) window.create()
      else if (db.recoveryStatus() !== undefined) recoveryWindow.show()
    }
  })
  void app.whenReady().then(ready, failed)
}

if (app.requestSingleInstanceLock()) start()
else app.quit()

// macOS keeps the app running with no windows; the dock icon stays put and
// reopens one. Every other platform treats the app as its window and quits.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  quitting = true
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
