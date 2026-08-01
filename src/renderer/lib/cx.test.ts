import { describe, expect, it } from 'vitest'
import { cx } from './cx.js'

describe('cx', () => {
  it('joins class names with a space', () => {
    expect(cx('a', 'b')).toBe('a b')
  })

  it('drops undefined, the shape a CSS module miss takes', () => {
    expect(cx('a', undefined, 'b')).toBe('a b')
  })

  it('drops false, the shape a conditional class takes', () => {
    expect(cx('a', false, 'b')).toBe('a b')
  })

  it('drops empty strings so no double space appears', () => {
    expect(cx('a', '', 'b')).toBe('a b')
  })

  it('returns an empty string when nothing survives', () => {
    expect(cx(undefined, false, '')).toBe('')
  })

  it('never emits the text "undefined"', () => {
    expect(cx('a', undefined)).not.toContain('undefined')
  })
})
