import { BrowserWindow, type WebContents } from 'electron'
import { join } from 'node:path'
import { APP_ORIGIN } from './protocol.js'
import { currentTheme } from './prefs.js'
import { background, chromeOptions } from './window-chrome.js'

let recovery: BrowserWindow | undefined

function target(): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev === undefined ? `${APP_ORIGIN}/recovery.html` : `${dev}/recovery.html`
}

export function show(): BrowserWindow {
  if (recovery !== undefined && !recovery.isDestroyed()) {
    recovery.show()
    recovery.focus()
    return recovery
  }

  // The database may be the reason this window exists, so the theme read
  // must tolerate it being unavailable.
  const theme = currentTheme()
  const win = new BrowserWindow({
    width: 620,
    height: 460,
    minWidth: 520,
    minHeight: 400,
    show: false,
    title: 'Luna Recovery',
    ...chromeOptions(process.platform, theme),
    backgroundColor: background(theme),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  recovery = win
  win.once('ready-to-show', () => {
    win.show()
  })
  win.on('closed', () => {
    recovery = undefined
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== target()) event.preventDefault()
  })
  void win.loadURL(target()).catch(() => {
    if (!win.isDestroyed()) win.close()
  })
  return win
}

export function owns(sender: WebContents): boolean {
  return recovery !== undefined && !recovery.isDestroyed() && recovery.webContents === sender
}

export function finish(): void {
  if (recovery !== undefined && !recovery.isDestroyed()) recovery.close()
}
