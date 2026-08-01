import { describe, expect, it, vi } from 'vitest'
import { defaultPrefs, type Prefs } from '../../shared/prefs.js'
import { applySet, clean } from './prefs.js'

function deps() {
  const stored: Prefs[] = []
  return {
    stored,
    save: vi.fn((prefs: Prefs) => {
      stored.push(prefs)
      return prefs
    }),
    applyTheme: vi.fn(),
    notify: vi.fn(),
  }
}

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

describe('applySet', () => {
  it('stores the cleaned payload', () => {
    const d = deps()
    applySet({ ...defaultPrefs, theme: 'dark' }, d)
    expect(d.stored).toEqual([{ ...defaultPrefs, theme: 'dark' }])
  })

  it('announces the change so every window can follow it', () => {
    const d = deps()
    applySet({ ...defaultPrefs, defaultMode: 'expert' }, d)

    expect(d.notify).toHaveBeenCalledTimes(1)
    expect(d.notify).toHaveBeenCalledWith({ ...defaultPrefs, defaultMode: 'expert' })
  })

  it('announces what was stored, not what was sent', () => {
    const d = deps()
    applySet({ theme: 'neon', apiKey: 'test-injected' }, d)

    expect(d.notify).toHaveBeenCalledWith(defaultPrefs)
  })

  it('applies the theme before announcing, so a listener sees a settled app', () => {
    const d = deps()
    const order: string[] = []
    d.applyTheme.mockImplementation(() => order.push('theme'))
    d.notify.mockImplementation(() => order.push('notify'))

    applySet(defaultPrefs, d)
    expect(order).toEqual(['theme', 'notify'])
  })

  it('returns the stored value to the caller', () => {
    const r = applySet({ ...defaultPrefs, stream: false }, deps())
    expect(r.ok && r.value.stream).toBe(false)
  })

  it('announces nothing when the store fails', () => {
    const d = deps()
    d.save.mockImplementation(() => {
      throw new Error('write failed')
    })

    expect(() => {
      applySet(defaultPrefs, d)
    }).toThrow()
    expect(d.notify).not.toHaveBeenCalled()
  })
})
