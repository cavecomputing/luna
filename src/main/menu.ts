import { Menu, app } from 'electron'
import { keyboardShortcuts } from '../shared/keyboard-shortcuts.js'
import { openSettings, openShortcuts } from './window.js'

/**
 * macOS needs a real menu with standard roles. Without the edit roles,
 * Cmd+C / Cmd+V silently stop working and the app feels broken.
 */
export function build(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings\u2026',
          accelerator: keyboardShortcuts.settings.accelerator,
          click: () => {
            openSettings()
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [{ role: 'close' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: keyboardShortcuts.shortcuts.accelerator,
          click: () => {
            openShortcuts()
          },
        },
      ],
    },
  ])

  Menu.setApplicationMenu(menu)
}
