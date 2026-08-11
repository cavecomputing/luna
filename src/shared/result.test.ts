import { describe, expect, it } from 'vitest'
import { err, ok } from './result.js'

describe('ok', () => {
  it('wraps a value and reports success', () => {
    const r = ok(42)
    expect(r.ok).toBe(true)
    expect(r.value).toBe(42)
  })
})

describe('err', () => {
  it('carries a stable code separate from the message', () => {
    const r = err('file/not-found', 'read failed')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('file/not-found')
    expect(r.message).toBe('read failed')
  })
})
