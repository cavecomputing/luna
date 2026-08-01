import { describe, expect, it } from 'vitest'
import { relative } from './time.js'

const NOW = 1_700_000_000_000
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const ago = (ms: number) => relative(NOW - ms, NOW)

describe('relative', () => {
  it('says Just now under a minute', () => {
    expect(ago(0)).toBe('Just now')
    expect(ago(59_000)).toBe('Just now')
  })

  it('counts minutes up to an hour', () => {
    expect(ago(MIN)).toBe('1 min ago')
    expect(ago(59 * MIN)).toBe('59 mins ago')
  })

  it('counts hours up to a day', () => {
    expect(ago(HOUR)).toBe('1 hour ago')
    expect(ago(23 * HOUR)).toBe('23 hours ago')
  })

  it('says Yesterday on the second day', () => {
    expect(ago(DAY)).toBe('Yesterday')
    expect(ago(2 * DAY - 1)).toBe('Yesterday')
  })

  it('counts days up to a week', () => {
    expect(ago(2 * DAY)).toBe('2 days ago')
    expect(ago(6 * DAY)).toBe('6 days ago')
  })

  it('counts weeks beyond that', () => {
    expect(ago(7 * DAY)).toBe('1 week ago')
    expect(ago(21 * DAY)).toBe('3 weeks ago')
  })

  it('never pluralises a single unit', () => {
    expect(ago(MIN)).not.toContain('mins')
    expect(ago(HOUR)).not.toContain('hours')
  })
})
