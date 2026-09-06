import { describe, expect, it } from 'vitest'
import { conversationTokens, formatTokens, totalTokens, usageDetail } from './usage.js'

describe('totalTokens', () => {
  it('adds input and output', () => {
    expect(totalTokens({ inputTokens: 120, outputTokens: 40 })).toBe(160)
  })

  /**
   * A provider that reported nothing must not read as a free turn, so this is
   * undefined rather than zero.
   */
  it('reports nothing when the provider reported nothing', () => {
    expect(totalTokens(undefined)).toBeUndefined()
    expect(totalTokens({})).toBeUndefined()
    expect(totalTokens({ cachedTokens: 10 })).toBeUndefined()
  })

  it('counts a partial report', () => {
    expect(totalTokens({ outputTokens: 12 })).toBe(12)
  })
})

describe('formatTokens', () => {
  it('shows small counts exactly', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
  })

  it('abbreviates thousands, with a decimal only while it is informative', () => {
    expect(formatTokens(1_200)).toBe('1.2k')
    expect(formatTokens(45_000)).toBe('45k')
  })

  it('abbreviates millions', () => {
    expect(formatTokens(2_400_000)).toBe('2.4M')
  })
})

describe('usageDetail', () => {
  it('breaks the total down', () => {
    expect(usageDetail({ inputTokens: 120, outputTokens: 40 })).toBe('120 in · 40 out')
  })

  /** Zero cached would read as "none reused" rather than "not measured". */
  it('omits fields the provider never reported', () => {
    expect(usageDetail({ outputTokens: 40 })).toBe('40 out')
    expect(usageDetail({})).toBe('')
  })

  it('includes reasoning and cached when present', () => {
    expect(usageDetail({ inputTokens: 1, outputTokens: 2, reasoningTokens: 3, cachedTokens: 4 }))
      .toBe('1 in · 2 out · 3 reasoning · 4 cached')
  })
})

describe('conversationTokens', () => {
  it('sums every turn that reported usage', () => {
    expect(
      conversationTokens([
        { usage: { inputTokens: 100, outputTokens: 10 } },
        {},
        { usage: { inputTokens: 200, outputTokens: 20 } },
      ]),
    ).toBe(330)
  })

  it('reports nothing for a conversation where nothing was measured', () => {
    expect(conversationTokens([])).toBeUndefined()
    expect(conversationTokens([{}, { usage: {} }])).toBeUndefined()
  })
})
