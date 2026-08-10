import { describe, expect, it } from 'vitest'
import {
  keyboardShortcutOrder,
  keyboardShortcuts,
  shortcutKeys,
} from './keyboard-shortcuts.js'

describe('keyboard shortcuts', () => {
  it('keeps every shortcut in the displayed catalog', () => {
    expect(new Set(keyboardShortcutOrder)).toEqual(new Set(Object.keys(keyboardShortcuts)))
  })

  it('uses the requested Cmd shortcuts on macOS', () => {
    expect(keyboardShortcuts.settings.accelerator).toBe('CmdOrCtrl+,')
    expect(keyboardShortcuts.shortcuts.accelerator).toBe('CmdOrCtrl+?')
    expect(shortcutKeys('settings', 'darwin')).toEqual(['⌘', ','])
    expect(shortcutKeys('shortcuts', 'darwin')).toEqual(['⌘', '?'])
  })

  it('shows cross-platform equivalents elsewhere', () => {
    expect(shortcutKeys('settings', 'win32')).toEqual(['Ctrl', ','])
    expect(shortcutKeys('shortcuts', 'linux')).toEqual(['Ctrl', '?'])
  })
})
