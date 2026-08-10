import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { APP_ORIGIN } from './protocol.js'
import { background, chromeOptions, overlay } from './window-chrome.js'
import { canFrameLoad } from './navigation.js'

const MIN_WIDTH = 720
const MIN_HEIGHT = 480

const SETTINGS_WIDTH = 800
const SETTINGS_HEIGHT = 580

/** Only ever one Settings window; a second ⌘, focuses the existing one. */
let settings: BrowserWindow | undefined

export function create(): BrowserWindow {
  const win = build({
    width: 1100,
    height: 720,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  })

  load(win, 'index.html')
  return win
}

export function openSettings(): BrowserWindow {
  if (settings !== undefined && !settings.isDestroyed()) {
    settings.show()
    settings.focus()
    return settings
  }

  const win = build({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    minWidth: 640,
    minHeight: 460,
    title: 'Settings',
  })

  win.on('closed', () => {
    settings = undefined
  })

  load(win, 'settings.html')
  settings = win
  return win
}

type Shape = {
  width: number
  height: number
  minWidth: number
  minHeight: number
  title?: string
}

function build(shape: Shape): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    ...shape,
    show: false,
    ...chromeOptions(process.platform, dark),
    backgroundColor: background(dark),
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
  return win
}

/** Keep Windows caption buttons legible when the persisted theme changes. */
export function updateChrome(win: BrowserWindow): void {
  if (process.platform === 'win32') {
    win.setTitleBarOverlay(overlay(nativeTheme.shouldUseDarkColors))
  }
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

  win.webContents.on('will-frame-navigate', (details) => {
    if (!canFrameLoad(details.url, details.isMainFrame)) details.preventDefault()
  })
}

function devUrl(): string | undefined {
  return process.env.ELECTRON_RENDERER_URL
}

function load(win: BrowserWindow, page: string): void {
  const dev = devUrl()
  void win.loadURL(dev === undefined ? `${APP_ORIGIN}/${page}` : `${dev}/${page}`)
}
