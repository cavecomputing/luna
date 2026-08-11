import { describe, expect, it } from 'vitest'
import { id, object, text } from './parse.js'

describe('object', () => {
  it('returns a plain copy of an object', () => {
    expect(object({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' })
  })

  it('returns undefined for non-objects', () => {
    expect(object(null)).toBeUndefined()
    expect(object(undefined)).toBeUndefined()
    expect(object('x')).toBeUndefined()
    expect(object(3)).toBeUndefined()
  })
})

describe('id', () => {
  it('accepts generated uuids and simple names', () => {
    expect(id('0b3f7a2e-9c1d-4e5f-8a6b-2d4e6f8a0c1e')).toBe('0b3f7a2e-9c1d-4e5f-8a6b-2d4e6f8a0c1e')
    expect(id('openai')).toBe('openai')
    expect(id('a_b-C9')).toBe('a_b-C9')
  })

  it('rejects other shapes and lengths', () => {
    expect(id('')).toBeUndefined()
    expect(id('has space')).toBeUndefined()
    expect(id('path/traversal')).toBeUndefined()
    expect(id('x'.repeat(65))).toBeUndefined()
    expect(id(7)).toBeUndefined()
  })
})

describe('text', () => {
  it('trims and accepts text under the bound', () => {
    expect(text('  hello  ', 10)).toBe('hello')
    expect(text('', 10)).toBe('')
  })

  it('rejects oversized or non-string input', () => {
    expect(text('abc', 2)).toBeUndefined()
    expect(text(5, 10)).toBeUndefined()
    expect(text(null, 10)).toBeUndefined()
  })
})
