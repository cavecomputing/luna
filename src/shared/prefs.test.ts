import { describe, expect, it } from 'vitest'
import { defaultPrefs, parsePrefs } from './prefs.js'

describe('parsePrefs', () => {
  it('returns defaults for a missing file', () => {
    expect(parsePrefs(undefined)).toEqual(defaultPrefs)
  })

  it('returns defaults for null', () => {
    expect(parsePrefs(null)).toEqual(defaultPrefs)
  })

  it('returns defaults for a non-object', () => {
    expect(parsePrefs('nonsense')).toEqual(defaultPrefs)
    expect(parsePrefs(42)).toEqual(defaultPrefs)
  })

  it('keeps every valid field', () => {
    const prefs = {
      theme: 'luna-dark' as const,
      defaultMode: 'expert' as const,
      autoTitle: false,
      stream: false,
      sidebarWidth: 320,
    }
    expect(parsePrefs(prefs)).toEqual(prefs)
  })

  it('accepts every named theme', () => {
    for (const theme of ['luna-light', 'luna-dark', 'gruvbox-light', 'gruvbox-dark'] as const) {
      expect(parsePrefs({ theme }).theme).toBe(theme)
    }
  })

  it('maps themes written by older builds onto their named equivalents', () => {
    expect(parsePrefs({ theme: 'light' }).theme).toBe('luna-light')
    expect(parsePrefs({ theme: 'dark' }).theme).toBe('luna-dark')
    expect(parsePrefs({ theme: 'system' }).theme).toBe('luna-light')
  })

  it('falls back per field rather than discarding the whole file', () => {
    const out = parsePrefs({ theme: 'chartreuse', stream: false })
    expect(out.theme).toBe(defaultPrefs.theme)
    expect(out.stream).toBe(false)
  })

  it('rejects a theme outside the allowed set', () => {
    expect(parsePrefs({ theme: 'solarized' }).theme).toBe('luna-light')
  })

  it('rejects a boolean given as a string', () => {
    expect(parsePrefs({ autoTitle: 'true' }).autoTitle).toBe(defaultPrefs.autoTitle)
  })

  it('ignores the retired system prompt preference', () => {
    expect(parsePrefs({ systemPrompt: 'Replace Luna.' })).toEqual(defaultPrefs)
  })

  it('keeps a valid sidebar width and rejects values outside its range', () => {
    expect(parsePrefs({ sidebarWidth: 320 }).sidebarWidth).toBe(320)
    expect(parsePrefs({ sidebarWidth: 120 }).sidebarWidth).toBe(defaultPrefs.sidebarWidth)
    expect(parsePrefs({ sidebarWidth: 421 }).sidebarWidth).toBe(defaultPrefs.sidebarWidth)
  })

  it('ignores unknown fields', () => {
    expect(parsePrefs({ apiKey: 'test-should-never-live-here' })).toEqual(defaultPrefs)
  })

  it('never carries a secret-looking field through', () => {
    const out = parsePrefs({ theme: 'gruvbox-dark', apiKey: 'test-abc', token: 'test-xyz' })
    expect(Object.keys(out)).toEqual(Object.keys(defaultPrefs))
  })

  it('defaults to Luna Light, matching the shipped appearance', () => {
    expect(defaultPrefs.theme).toBe('luna-light')
  })
})
