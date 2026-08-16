import { describe, expect, it } from 'vitest'
import { canRenderHtml, isThinkingLive } from './message.js'

describe('HTML preview readiness', () => {
  it('waits for both a terminal status and settled visible text', () => {
    expect(canRenderHtml('streaming', '<p>Done</p>', '<p>Done</p>')).toBe(false)
    expect(canRenderHtml('complete', '<p>Par', '<p>Partial</p>')).toBe(false)
    expect(canRenderHtml('complete', '<p>Done</p>', '<p>Done</p>')).toBe(true)
    expect(canRenderHtml('cancelled', '<p>Partial</p>', '<p>Partial</p>')).toBe(true)
    expect(canRenderHtml('error', '<p>Partial</p>', '<p>Partial</p>')).toBe(true)
  })
})

describe('isThinkingLive', () => {
  it('is true only while streaming and before any answer text is visible', () => {
    expect(isThinkingLive('streaming', '')).toBe(true)
    expect(isThinkingLive('streaming', 'Partial answer')).toBe(false)
    expect(isThinkingLive('complete', '')).toBe(false)
    expect(isThinkingLive('cancelled', '')).toBe(false)
    expect(isThinkingLive('error', '')).toBe(false)
  })
})
