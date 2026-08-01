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
      theme: 'dark' as const,
      defaultMode: 'expert' as const,
      autoTitle: false,
      stream: false,
      systemPrompt: 'Be brief.',
    }
    expect(parsePrefs(prefs)).toEqual(prefs)
  })

  it('falls back per field rather than discarding the whole file', () => {
    const out = parsePrefs({ theme: 'chartreuse', systemPrompt: 'Be brief.' })
    expect(out.theme).toBe(defaultPrefs.theme)
    expect(out.systemPrompt).toBe('Be brief.')
  })

  it('rejects a theme outside the allowed set', () => {
    expect(parsePrefs({ theme: 'solarized' }).theme).toBe('light')
  })

  it('rejects a boolean given as a string', () => {
    expect(parsePrefs({ autoTitle: 'true' }).autoTitle).toBe(defaultPrefs.autoTitle)
  })

  it('rejects a system prompt that is not a string', () => {
    expect(parsePrefs({ systemPrompt: { evil: true } }).systemPrompt).toBe('')
  })

  it('ignores unknown fields', () => {
    expect(parsePrefs({ apiKey: 'test-should-never-live-here' })).toEqual(defaultPrefs)
  })

  it('never carries a secret-looking field through', () => {
    const out = parsePrefs({ theme: 'dark', apiKey: 'test-abc', token: 'test-xyz' })
    expect(Object.keys(out)).toEqual(Object.keys(defaultPrefs))
  })

  it('defaults to light, matching the shipped appearance', () => {
    expect(defaultPrefs.theme).toBe('light')
  })
})
