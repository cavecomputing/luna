import { describe, expect, it } from 'vitest'
import {
  keyboardShortcutOrder,
  keyboardShortcuts,
  matchesShortcutKey,
  shortcutKeys,
} from './keyboard-shortcuts.js'

describe('keyboard shortcuts', () => {
  it('keeps every shortcut in the displayed catalog', () => {
    expect(new Set(keyboardShortcutOrder)).toEqual(new Set(Object.keys(keyboardShortcuts)))
  })

  it('uses the requested Cmd shortcuts on macOS', () => {
    expect(keyboardShortcuts.newChat.accelerator).toBe('CmdOrCtrl+N')
    expect(keyboardShortcuts.commandPalette.accelerator).toBe('CmdOrCtrl+P')
    expect(keyboardShortcuts.toggleSidebar.accelerator).toBe('CmdOrCtrl+B')
    expect(keyboardShortcuts.toggleMode.accelerator).toBe('CmdOrCtrl+Shift+M')
    expect(keyboardShortcuts.settings.accelerator).toBe('CmdOrCtrl+,')
    expect(keyboardShortcuts.shortcuts.accelerator).toBe('CmdOrCtrl+?')
    expect(shortcutKeys('newChat', 'darwin')).toEqual(['⌘', 'N'])
    expect(shortcutKeys('commandPalette', 'darwin')).toEqual(['⌘', 'P'])
    expect(shortcutKeys('toggleSidebar', 'darwin')).toEqual(['⌘', 'B'])
    expect(shortcutKeys('toggleMode', 'darwin')).toEqual(['⌘', '⇧', 'M'])
    expect(shortcutKeys('settings', 'darwin')).toEqual(['⌘', ','])
    expect(shortcutKeys('shortcuts', 'darwin')).toEqual(['⌘', '?'])
  })

  it('shows cross-platform equivalents elsewhere', () => {
    expect(shortcutKeys('toggleSidebar', 'win32')).toEqual(['Ctrl', 'B'])
    expect(shortcutKeys('toggleMode', 'win32')).toEqual(['Ctrl', 'Shift', 'M'])
    expect(shortcutKeys('settings', 'win32')).toEqual(['Ctrl', ','])
    expect(shortcutKeys('shortcuts', 'linux')).toEqual(['Ctrl', '?'])
  })

  it('keeps machine-readable matching beside displayed shortcuts', () => {
    expect(keyboardShortcuts.search.match).toEqual({ key: 'f', code: 'KeyF', shift: false })
    expect(matchesShortcutKey('toggleSidebar', 'B', '', false)).toBe(true)
    expect(matchesShortcutKey('toggleMode', 'M', '', true)).toBe(true)
    expect(matchesShortcutKey('search', 'F', '', false)).toBe(true)
    expect(matchesShortcutKey('shortcuts', '?', '', true)).toBe(true)
    expect(matchesShortcutKey('shortcuts', '/', 'Slash', false)).toBe(false)
    expect(matchesShortcutKey('close', 'Escape', '', false)).toBe(true)
  })
})
