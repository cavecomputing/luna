import { describe, expect, it } from 'vitest'
import { closesAuxiliary, matchesShortcut, type ShortcutInput } from './shortcut-input.js'

function input(overrides: Partial<ShortcutInput> = {}): ShortcutInput {
  return {
    type: 'keyDown',
    key: '',
    code: '',
    alt: false,
    control: false,
    meta: false,
    shift: false,
    ...overrides,
  }
}

describe('window shortcuts', () => {
  it('matches Cmd+N and Cmd+P on macOS', () => {
    expect(matchesShortcut(input({ key: 'n', meta: true }), 'newChat', 'darwin')).toBe(true)
    expect(
      matchesShortcut(input({ code: 'KeyP', meta: true }), 'commandPalette', 'darwin'),
    ).toBe(true)
  })

  it('matches Cmd+B on macOS and Ctrl+B elsewhere', () => {
    expect(matchesShortcut(input({ key: 'b', meta: true }), 'toggleSidebar', 'darwin')).toBe(
      true,
    )
    expect(
      matchesShortcut(input({ code: 'KeyB', control: true }), 'toggleSidebar', 'win32'),
    ).toBe(true)
  })

  it('matches Cmd+, on macOS', () => {
    expect(matchesShortcut(input({ key: ',', meta: true }), 'settings', 'darwin')).toBe(true)
  })

  it('matches Cmd+? using either key representation', () => {
    expect(
      matchesShortcut(input({ key: '?', meta: true, shift: true }), 'shortcuts', 'darwin'),
    ).toBe(true)
    expect(
      matchesShortcut(input({ code: 'Slash', meta: true, shift: true }), 'shortcuts', 'darwin'),
    ).toBe(true)
  })

  it('uses Ctrl outside macOS and rejects extra modifiers', () => {
    expect(
      matchesShortcut(input({ code: 'Slash', control: true, shift: true }), 'shortcuts', 'win32'),
    ).toBe(true)
    expect(
      matchesShortcut(
        input({ code: 'Slash', control: true, shift: true, alt: true }),
        'shortcuts',
        'win32',
      ),
    ).toBe(false)
  })

  it('closes an auxiliary window with Cmd+, or plain Escape', () => {
    expect(closesAuxiliary(input({ key: ',', meta: true }), 'darwin')).toBe(true)
    expect(closesAuxiliary(input({ key: 'Escape' }), 'darwin')).toBe(true)
    expect(closesAuxiliary(input({ key: 'Escape', shift: true }), 'darwin')).toBe(false)
  })
})
