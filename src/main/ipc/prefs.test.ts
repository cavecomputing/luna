import { describe, expect, it } from 'vitest'
import { defaultPrefs } from '../../shared/prefs.js'
import { clean } from './prefs.js'

describe('clean', () => {
  it('accepts a well-formed payload', () => {
    const r = clean({ ...defaultPrefs, theme: 'dark' })
    expect(r.ok && r.value.theme).toBe('dark')
  })

  it('replaces a bad field with its default rather than failing', () => {
    const r = clean({ theme: 'neon' })
    expect(r.ok && r.value.theme).toBe(defaultPrefs.theme)
  })

  it('survives a renderer sending nothing', () => {
    const r = clean(undefined)
    expect(r.ok && r.value).toEqual(defaultPrefs)
  })

  it('strips fields the renderer invented', () => {
    const r = clean({ theme: 'dark', apiKey: 'test-injected' })
    expect(r.ok && Object.keys(r.value)).toEqual(Object.keys(defaultPrefs))
  })

  it('never lets a renderer store a secret in prefs', () => {
    const r = clean({ token: 'test-abc' })
    expect(r.ok && JSON.stringify(r.value)).not.toContain('test-abc')
  })
})
