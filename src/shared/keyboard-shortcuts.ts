export const keyboardShortcuts = {
  newChat: {
    label: 'New chat',
    accelerator: 'CmdOrCtrl+N',
    macKeys: ['⌘', 'N'],
    otherKeys: ['Ctrl', 'N'],
    match: { key: 'n', code: 'KeyN', shift: false },
  },
  commandPalette: {
    label: 'Command palette (WIP)',
    accelerator: 'CmdOrCtrl+P',
    macKeys: ['⌘', 'P'],
    otherKeys: ['Ctrl', 'P'],
    match: { key: 'p', code: 'KeyP', shift: false },
  },
  search: {
    label: 'Search conversations',
    accelerator: 'CmdOrCtrl+F',
    macKeys: ['⌘', 'F'],
    otherKeys: ['Ctrl', 'F'],
    match: { key: 'f', code: 'KeyF', shift: false },
  },
  toggleSidebar: {
    label: 'Toggle sidebar',
    accelerator: 'CmdOrCtrl+B',
    macKeys: ['⌘', 'B'],
    otherKeys: ['Ctrl', 'B'],
    match: { key: 'b', code: 'KeyB', shift: false },
  },
  toggleMode: {
    label: 'Toggle Fast / Expert mode',
    accelerator: 'CmdOrCtrl+Shift+M',
    macKeys: ['⌘', '⇧', 'M'],
    otherKeys: ['Ctrl', 'Shift', 'M'],
    match: { key: 'm', code: 'KeyM', shift: true },
  },
  settings: {
    label: 'Open Settings',
    accelerator: 'CmdOrCtrl+,',
    macKeys: ['⌘', ','],
    otherKeys: ['Ctrl', ','],
    match: { key: ',', code: 'Comma', shift: false },
  },
  shortcuts: {
    label: 'Keyboard shortcuts',
    accelerator: 'CmdOrCtrl+?',
    macKeys: ['⌘', '?'],
    otherKeys: ['Ctrl', '?'],
    match: { key: '?', code: 'Slash', shift: true },
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
    match: { key: 'Escape', code: 'Escape', shift: false },
  },
} as const

export type KeyboardShortcutId = keyof typeof keyboardShortcuts
export type MatchableShortcutId =
  | 'newChat'
  | 'commandPalette'
  | 'search'
  | 'toggleSidebar'
  | 'toggleMode'
  | 'settings'
  | 'shortcuts'
  | 'close'

export const keyboardShortcutOrder: KeyboardShortcutId[] = [
  'newChat',
  'commandPalette',
  'search',
  'toggleSidebar',
  'toggleMode',
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

export function matchesShortcutKey(
  id: MatchableShortcutId,
  key: string,
  code: string,
  shift: boolean,
): boolean {
  const expected = keyboardShortcuts[id].match
  if (shift !== expected.shift) return false
  if (code === expected.code) return true
  if (expected.key.length === 1 && expected.key !== '?') {
    return key.toLowerCase() === expected.key
  }
  return key === expected.key
}
