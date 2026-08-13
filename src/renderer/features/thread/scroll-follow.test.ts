import { describe, expect, it } from 'vitest'
import { followStep, isNearBottom } from './scroll-follow.js'

describe('scroll following', () => {
  it('follows while the reader is at or near the bottom', () => {
    expect(isNearBottom({ scrollTop: 900, clientHeight: 500, scrollHeight: 1400 })).toBe(true)
    expect(isNearBottom({ scrollTop: 850, clientHeight: 500, scrollHeight: 1400 })).toBe(true)
  })

  it('stops following after the reader scrolls into history', () => {
    expect(isNearBottom({ scrollTop: 600, clientHeight: 500, scrollHeight: 1400 })).toBe(false)
  })

  it('does not move until content extends below the viewport', () => {
    expect(followStep({ scrollTop: 900, clientHeight: 500, scrollHeight: 1400 })).toBeUndefined()
  })

  it('advances toward newly hidden content without jumping to the bottom', () => {
    expect(followStep({ scrollTop: 900, clientHeight: 500, scrollHeight: 1420 })).toBe(905)
    expect(followStep({ scrollTop: 900, clientHeight: 500, scrollHeight: 1600 })).toBe(912)
  })
})
