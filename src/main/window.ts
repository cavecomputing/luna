import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { APP_ORIGIN } from './protocol.js'

const MIN_WIDTH = 720
const MIN_HEIGHT = 480

export function create(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f5f6f8',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  // Avoids a white flash before the first paint.
  win.once('ready-to-show', () => {
    win.show()
  })

  lockNavigation(win)
  load(win)
  return win
}

/** Focus the existing window, or make one if the last was closed. */
export function show(): void {
  const [win] = BrowserWindow.getAllWindows()
  if (win === undefined) {
    create()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Deny by default. Real links open in the user's browser, not in the app. */
function lockNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(devUrl() ?? APP_ORIGIN)) event.preventDefault()
  })
}

function devUrl(): string | undefined {
  return process.env.ELECTRON_RENDERER_URL
}

function load(win: BrowserWindow): void {
  const dev = devUrl()
  if (dev !== undefined) {
    void win.loadURL(dev)
    return
  }
  void win.loadURL(`${APP_ORIGIN}/index.html`)
}
