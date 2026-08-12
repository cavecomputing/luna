import {
  BrowserWindow,
  nativeTheme,
  screen,
  shell,
  type RenderProcessGoneDetails,
  type WebContents,
} from 'electron'
import { join } from 'node:path'
import * as db from './db.js'
import { APP_ORIGIN } from './protocol.js'
import { background, chromeOptions, overlay, settingsMinimum } from './window-chrome.js'
import { canFrameLoad } from './navigation.js'
import { closesAuxiliary, matchesShortcut } from './shortcut-input.js'
import { emit } from './ipc/bus.js'
import * as windowState from './window-state.js'
import { canAutoRecover, needsRecovery } from './crash-recovery.js'

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
let settingsCanClose = false
let settingsCloseTimer: ReturnType<typeof setTimeout> | undefined
let quitting = false
const recoveryTargets = new WeakMap<BrowserWindow, string>()
const recoveryWindows = new WeakSet<BrowserWindow>()
const autoRecoveries = new WeakMap<BrowserWindow, number>()

export function create(): BrowserWindow {
  if (main !== undefined && !main.isDestroyed()) {
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
    return main
  }

  const win = build(
    {
      width: 1100,
      height: 720,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
    },
    'main',
    'main',
  )

  win.on('closed', () => {
    main = undefined
  })

  load(win, 'index.html')
  main = win
  return win
}

type MainShortcutEvent =
  | 'shortcut:new-chat'
  | 'shortcut:command-palette'
  | 'shortcut:toggle-sidebar'
  | 'shortcut:toggle-mode'

function notifyMain(event: MainShortcutEvent): void {
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

export function toggleSidebar(): void {
  notifyMain('shortcut:toggle-sidebar')
}

export function toggleMode(): void {
  notifyMain('shortcut:toggle-mode')
}

export function openSettings(): BrowserWindow {
  if (settings !== undefined && !settings.isDestroyed()) {
    settings.show()
    settings.focus()
    return settings
  }

  const minimum = settingsMinimum(process.platform)
  const win = build(
    {
      width: SETTINGS_WIDTH,
      height: SETTINGS_HEIGHT,
      minWidth: minimum.width,
      minHeight: minimum.height,
      title: 'Settings',
    },
    'auxiliary',
    'settings',
  )

  settingsCanClose = false
  win.on('close', (event) => {
    if (settingsCanClose || win.webContents.isDestroyed() || recoveryWindows.has(win)) return
    event.preventDefault()
    emit(win.webContents, 'settings:close-requested', undefined)
    settingsCloseTimer ??= setTimeout(() => {
      settingsCanClose = true
      if (!win.isDestroyed()) win.close()
    }, 2_000)
  })

  win.on('closed', () => {
    if (settingsCloseTimer !== undefined) clearTimeout(settingsCloseTimer)
    settingsCloseTimer = undefined
    settingsCanClose = false
    settings = undefined
  })

  load(win, 'settings.html')
  settings = win
  return win
}

/** Completes a close only after the Settings renderer flushes pending fields. */
export function closeSettings(sender: WebContents): boolean {
  if (
    settings === undefined ||
    settings.isDestroyed() ||
    settings.webContents !== sender
  ) {
    return false
  }
  if (settingsCloseTimer !== undefined) clearTimeout(settingsCloseTimer)
  settingsCloseTimer = undefined
  settingsCanClose = true
  settings.close()
  return true
}

export function openShortcuts(): BrowserWindow {
  if (shortcuts !== undefined && !shortcuts.isDestroyed()) {
    shortcuts.show()
    shortcuts.focus()
    return shortcuts
  }

  const win = build(
    {
      width: SHORTCUTS_WIDTH,
      height: SHORTCUTS_HEIGHT,
      minWidth: 420,
      minHeight: 420,
      title: 'Keyboard Shortcuts',
    },
    'auxiliary',
    'shortcuts',
  )

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

type WindowKind = 'main' | 'auxiliary'

function build(shape: Shape, kind: WindowKind, stateName: windowState.WindowName): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const bounds = windowState.load(
    db.handle(),
    stateName,
    screen.getAllDisplays().map((display) => display.workArea),
    { width: shape.minWidth, height: shape.minHeight },
  )
  const win = new BrowserWindow({
    ...shape,
    ...bounds,
    show: false,
    ...chromeOptions(process.platform, dark),
    backgroundColor: background(dark),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
    },
  })

  // Avoids a white flash before the first paint.
  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('close', () => {
    windowState.save(db.handle(), stateName, win.getNormalBounds())
  })

  lockNavigation(win)
  bindShortcuts(win, kind)
  win.webContents.on('render-process-gone', (_event, details) => {
    rendererGone(win, details)
  })
  return win
}

function bindShortcuts(win: BrowserWindow, kind: WindowKind): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (kind === 'auxiliary' && closesAuxiliary(input, process.platform)) {
      event.preventDefault()
      win.close()
    } else if (matchesShortcut(input, 'newChat', process.platform)) {
      event.preventDefault()
      newChat()
    } else if (matchesShortcut(input, 'commandPalette', process.platform)) {
      event.preventDefault()
      openCommandPalette()
    } else if (matchesShortcut(input, 'toggleSidebar', process.platform)) {
      event.preventDefault()
      toggleSidebar()
    } else if (matchesShortcut(input, 'toggleMode', process.platform)) {
      event.preventDefault()
      toggleMode()
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
  recoveryTargets.set(win, page)
  recoveryWindows.delete(win)
  void navigate(win, page)
}

function navigate(win: BrowserWindow, page: string): Promise<void> {
  const dev = devUrl()
  return win.loadURL(dev === undefined ? `${APP_ORIGIN}/${page}` : `${dev}/${page}`)
}

function rendererGone(win: BrowserWindow, details: RenderProcessGoneDetails): void {
  console.error('renderer process gone', details.reason, details.exitCode)
  if (!needsRecovery(details.reason, quitting) || win.isDestroyed()) return

  // A second crash means the recovery renderer itself failed. Avoid a loop.
  if (recoveryWindows.has(win)) {
    win.close()
    return
  }

  const target = recoveryTargets.get(win)
  const now = Date.now()
  if (target !== undefined && canAutoRecover(autoRecoveries.get(win), now)) {
    autoRecoveries.set(win, now)
    void navigate(win, target).catch(() => {
      console.error('automatic renderer recovery failed')
      if (!win.isDestroyed()) showRecovery(win)
    })
    return
  }

  showRecovery(win)
}

function showRecovery(win: BrowserWindow): void {
  recoveryWindows.add(win)
  void navigate(win, 'crash.html').catch(() => {
    console.error('failed to load crash recovery')
    if (!win.isDestroyed()) win.close()
  })
}

/** Called from before-quit so renderer teardown cannot reopen a recovery page. */
export function beginQuit(): void {
  quitting = true
}

/** Only a window currently showing the recovery page may restore its target. */
export function recoverWindow(sender: WebContents): boolean {
  const win = BrowserWindow.fromWebContents(sender)
  const target = win === null ? undefined : recoveryTargets.get(win)
  if (win === null || target === undefined || !recoveryWindows.has(win)) return false

  setTimeout(() => {
    if (win.isDestroyed()) return
    recoveryWindows.delete(win)
    void navigate(win, target).catch(() => {
      console.error('failed to restore crashed window')
      if (!win.isDestroyed()) rendererGone(win, { reason: 'launch-failed', exitCode: 0 })
    })
  }, 0)
  return true
}

/** Closes the recovery window without waiting on a renderer that already failed. */
export function closeCrashedWindow(sender: WebContents): boolean {
  const win = BrowserWindow.fromWebContents(sender)
  if (win === null || !recoveryWindows.has(win)) return false

  setTimeout(() => {
    if (win.isDestroyed()) return
    if (win === settings) settingsCanClose = true
    win.close()
  }, 0)
  return true
}
