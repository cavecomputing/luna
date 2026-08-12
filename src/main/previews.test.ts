import { describe, expect, it } from 'vitest'
import { PreviewCache, previewDocument } from './previews.js'

describe('PreviewCache', () => {
  it('stores a bounded preview for its owner', () => {
    const cache = new PreviewCache({ ttlMs: 100 })
    const created = cache.create(7, '<style>p { color: red }</style><p>Hello</p>', 10, 'preview-1')

    expect(created).toEqual({
      ok: true,
      value: { id: 'preview-1', url: 'app://preview/preview-1' },
    })
    expect(cache.read('preview-1', 20)).toContain('color: red')
  })

  it('rejects oversized documents and owner overflow', () => {
    const cache = new PreviewCache({ maxBytes: 4, maxPerOwner: 1 })

    expect(cache.create(1, '12345', 0, 'large')).toMatchObject({
      ok: false,
      code: 'preview/too-large',
    })
    expect(cache.create(1, 'one', 0, 'first').ok).toBe(true)
    expect(cache.create(1, 'two', 0, 'second')).toMatchObject({
      ok: false,
      code: 'preview/limit',
    })
    expect(cache.create(2, 'two', 0, 'other').ok).toBe(true)
  })

  it('expires entries and only releases them for their owner', () => {
    const cache = new PreviewCache({ ttlMs: 10 })
    cache.create(1, 'private', 5, 'owned')

    cache.release(2, 'owned')
    expect(cache.read('owned', 14)).toBe('private')
    expect(cache.read('owned', 15)).toBeUndefined()
  })

  it('clears every preview belonging to a destroyed renderer', () => {
    const cache = new PreviewCache()
    cache.create(1, 'one', 0, 'one')
    cache.create(1, 'two', 0, 'two')
    cache.create(2, 'other', 0, 'other')

    cache.clearOwner(1)

    expect(cache.read('one', 1)).toBeUndefined()
    expect(cache.read('two', 1)).toBeUndefined()
    expect(cache.read('other', 1)).toBe('other')
  })
})

describe('previewDocument', () => {
  it('keeps untrusted markup after the fixed document controls', () => {
    const html = '<style>.card { color: red }</style><div class="card">Hello</div>'
    const document = previewDocument(html)

    expect(document.indexOf('<base target="_blank">')).toBeLessThan(document.indexOf(html))
    expect(document).toContain(html)
    expect(document).not.toContain('Content-Security-Policy')
  })
})
