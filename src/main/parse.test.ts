import { describe, expect, it } from 'vitest'
import { array, id, object, record, text, toolName } from './parse.js'

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

describe('toolName', () => {
  it('accepts the dotted and long names the protocol allows', () => {
    expect(toolName('admin.tools.list')).toBe('admin.tools.list')
    expect(toolName('DATA_EXPORT_v2')).toBe('DATA_EXPORT_v2')
    expect(toolName('get-weather')).toBe('get-weather')
    expect(toolName('x'.repeat(128))).toHaveLength(128)
  })

  it('rejects names outside the allowed characters and length', () => {
    expect(toolName('')).toBeUndefined()
    expect(toolName('has space')).toBeUndefined()
    expect(toolName('comma,name')).toBeUndefined()
    expect(toolName('path/traversal')).toBeUndefined()
    expect(toolName('x'.repeat(129))).toBeUndefined()
    expect(toolName(7)).toBeUndefined()
  })

  /** id() guards filesystem paths, so it must stay narrow even though tools do not. */
  it('is separate from id, which still rejects dots', () => {
    expect(id('admin.tools.list')).toBeUndefined()
    expect(id('x'.repeat(65))).toBeUndefined()
  })
})

describe('array', () => {
  it('parses every entry', () => {
    expect(array(['a', 'b'], (item) => (typeof item === 'string' ? item : undefined)))
      .toEqual(['a', 'b'])
    expect(array([], () => undefined)).toEqual([])
  })

  it('rejects the whole array when one entry fails', () => {
    expect(array(['a', 3], (item) => (typeof item === 'string' ? item : undefined)))
      .toBeUndefined()
  })

  it('rejects anything that is not an array', () => {
    expect(array({ 0: 'a' }, (item) => item)).toBeUndefined()
    expect(array(null, (item) => item)).toBeUndefined()
  })
})

describe('record', () => {
  it('parses every value', () => {
    expect(record({ a: '1', b: '2' }, (value) => (typeof value === 'string' ? value : undefined)))
      .toEqual({ a: '1', b: '2' })
    expect(record({}, () => undefined)).toEqual({})
  })

  it('rejects the whole map when one value fails', () => {
    expect(record({ a: '1', b: 2 }, (value) => (typeof value === 'string' ? value : undefined)))
      .toBeUndefined()
  })

  it('rejects anything that is not an object', () => {
    expect(record('a', (value) => value)).toBeUndefined()
    expect(record(null, (value) => value)).toBeUndefined()
  })
})
