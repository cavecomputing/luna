export const keyboardShortcuts = {
  search: {
    label: 'Search conversations',
    accelerator: 'CmdOrCtrl+F',
    macKeys: ['⌘', 'F'],
    otherKeys: ['Ctrl', 'F'],
  },
  settings: {
    label: 'Open Settings',
    accelerator: 'CmdOrCtrl+,',
    macKeys: ['⌘', ','],
    otherKeys: ['Ctrl', ','],
  },
  shortcuts: {
    label: 'Keyboard shortcuts',
    accelerator: 'CmdOrCtrl+?',
    macKeys: ['⌘', '?'],
    otherKeys: ['Ctrl', '?'],
  },
  send: {
    label: 'Send message',
    macKeys: ['Return'],
    otherKeys: ['Enter'],
  },
  newline: {
    label: 'Insert a new line',
    macKeys: ['⇧', 'Return'],
    otherKeys: ['Shift', 'Enter'],
  },
  close: {
    label: 'Close a dialog',
    macKeys: ['Esc'],
    otherKeys: ['Esc'],
  },
} as const

export type KeyboardShortcutId = keyof typeof keyboardShortcuts

export const keyboardShortcutOrder: KeyboardShortcutId[] = [
  'search',
  'settings',
  'shortcuts',
  'send',
  'newline',
  'close',
]

export function shortcutKeys(id: KeyboardShortcutId, platform: string): readonly string[] {
  const shortcut = keyboardShortcuts[id]
  return platform === 'darwin' ? shortcut.macKeys : shortcut.otherKeys
}
