import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { APP_ORIGIN } from './protocol.js'
import { background, chromeOptions, overlay } from './window-chrome.js'
import { canFrameLoad } from './navigation.js'
import { matchesShortcut } from './shortcut-input.js'
import { emit } from './ipc/bus.js'

const MIN_WIDTH = 720
const MIN_HEIGHT = 480

const SETTINGS_WIDTH = 800
const SETTINGS_HEIGHT = 580
const SHORTCUTS_WIDTH = 520
const SHORTCUTS_HEIGHT = 500

/** Only ever one Settings window; a second ⌘, focuses the existing one. */
let main: BrowserWindow | undefined
let settings: BrowserWindow | undefined
let shortcuts: BrowserWindow | undefined

export function create(): BrowserWindow {
  if (main !== undefined && !main.isDestroyed()) {
    main.show()
    main.focus()
    return main
  }

  const win = build({
    width: 1100,
    height: 720,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  })

  win.on('closed', () => {
    main = undefined
  })

  load(win, 'index.html')
  main = win
  return win
}

function notifyMain(event: 'shortcut:new-chat' | 'shortcut:command-palette'): void {
  const win = create()
  const notify = (): void => {
    win.show()
    win.focus()
    emit(win.webContents, event, undefined)
  }
  if (win.webContents.isLoadingMainFrame()) win.once('ready-to-show', notify)
  else notify()
}

export function newChat(): void {
  notifyMain('shortcut:new-chat')
}

export function openCommandPalette(): void {
  notifyMain('shortcut:command-palette')
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

export function openShortcuts(): BrowserWindow {
  if (shortcuts !== undefined && !shortcuts.isDestroyed()) {
    shortcuts.show()
    shortcuts.focus()
    return shortcuts
  }

  const win = build({
    width: SHORTCUTS_WIDTH,
    height: SHORTCUTS_HEIGHT,
    minWidth: 420,
    minHeight: 420,
    title: 'Keyboard Shortcuts',
  })

  win.on('closed', () => {
    shortcuts = undefined
  })

  load(win, 'shortcuts.html')
  shortcuts = win
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
  bindShortcuts(win)
  return win
}

function bindShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (matchesShortcut(input, 'newChat', process.platform)) {
      event.preventDefault()
      newChat()
    } else if (matchesShortcut(input, 'commandPalette', process.platform)) {
      event.preventDefault()
      openCommandPalette()
    } else if (matchesShortcut(input, 'settings', process.platform)) {
      event.preventDefault()
      openSettings()
    } else if (matchesShortcut(input, 'shortcuts', process.platform)) {
      event.preventDefault()
      openShortcuts()
    }
  })
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
