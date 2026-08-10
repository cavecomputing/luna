import { describe, expect, it } from 'vitest'
import { isNearBottom } from './scroll-follow.js'

describe('scroll following', () => {
  it('follows while the reader is at or near the bottom', () => {
    expect(isNearBottom({ scrollTop: 900, clientHeight: 500, scrollHeight: 1400 })).toBe(true)
    expect(isNearBottom({ scrollTop: 850, clientHeight: 500, scrollHeight: 1400 })).toBe(true)
  })

  it('stops following after the reader scrolls into history', () => {
    expect(isNearBottom({ scrollTop: 600, clientHeight: 500, scrollHeight: 1400 })).toBe(false)
  })
})
