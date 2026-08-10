// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { revealStep } from './use-smooth-text.js'

describe('revealStep', () => {
  it('reveals a small stream steadily rather than as one network chunk', () => {
    const step = revealStep(40, 16, 0, false)
    expect(step.count).toBeGreaterThan(0)
    expect(step.count).toBeLessThan(40)
  })

  it('accelerates when provider output builds a large backlog', () => {
    expect(revealStep(500, 16, 0, false).count).toBeGreaterThan(
      revealStep(10, 16, 0, false).count,
    )
  })

  it('catches up faster once the response has completed', () => {
    expect(revealStep(100, 16, 0, true).count).toBeGreaterThan(
      revealStep(100, 16, 0, false).count,
    )
  })

  it('carries fractional character budget between frames', () => {
    const first = revealStep(5, 1, 0, false)
    const second = revealStep(5, 12, first.carry, false)
    expect(first.count).toBe(0)
    expect(second.count).toBeGreaterThan(0)
  })
})
