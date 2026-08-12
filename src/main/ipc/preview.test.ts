import { describe, expect, it } from 'vitest'
import { PreviewCache } from '../previews.js'
import { createPreview, releasePreview } from './preview.js'

describe('preview IPC', () => {
  it('validates creation input without including content in an error', () => {
    const cache = new PreviewCache()

    expect(createPreview({ html: 42 }, 1, cache)).toEqual({
      ok: false,
      code: 'preview/invalid',
      message: 'HTML preview was invalid',
    })
  })

  it('creates and idempotently releases an owned preview', () => {
    const cache = new PreviewCache()
    const token = '12345678-1234-4123-8123-123456789abc'
    expect(createPreview({ html: '<p>Hello</p>' }, 1, cache, 0, token).ok).toBe(true)

    expect(releasePreview({ id: token }, 2, cache)).toEqual({ ok: true, value: undefined })
    expect(cache.read(token, 1)).toBe('<p>Hello</p>')
    expect(releasePreview({ id: token }, 1, cache)).toEqual({ ok: true, value: undefined })
    expect(releasePreview({ id: token }, 1, cache)).toEqual({ ok: true, value: undefined })
    expect(cache.read(token, 1)).toBeUndefined()
  })

  it('rejects malformed release identities', () => {
    expect(releasePreview({ id: '../secret' }, 1, new PreviewCache())).toMatchObject({
      ok: false,
      code: 'preview/invalid',
    })
  })
})
