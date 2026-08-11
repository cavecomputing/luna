import { describe, expect, it } from 'vitest'
import { isSearchShortcut } from './search-shortcut.js'

const key = (overrides: Partial<Parameters<typeof isSearchShortcut>[0]> = {}) => ({
  key: 'f',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
})

describe('isSearchShortcut', () => {
  it('accepts Ctrl+F on Windows', () => {
    expect(isSearchShortcut(key({ ctrlKey: true }))).toBe(true)
  })

  it('accepts Cmd+F on macOS', () => {
    expect(isSearchShortcut(key({ metaKey: true, key: 'F' }))).toBe(true)
  })

  it('rejects unmodified and Alt-modified F', () => {
    expect(isSearchShortcut(key())).toBe(false)
    expect(isSearchShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(isSearchShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
  })
})
