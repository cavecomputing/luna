import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTEXT_TOKENS,
  estimateTokens,
  historyBudget,
  planHistory,
  type Sized,
} from './tokens.js'

function turn(tokens: number): Sized[] {
  return [
    { role: 'user', tokens },
    { role: 'assistant', tokens },
  ]
}

describe('estimateTokens', () => {
  it('counts nothing for empty text', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('approximates latin text at four characters per token', () => {
    expect(estimateTokens('x'.repeat(400))).toBe(100)
  })

  /**
   * Averaging CJK in with latin would undercount a Chinese or Japanese
   * conversation badly — which is exactly the case where being wrong drops
   * messages that would have fit.
   */
  it('counts CJK closer to one token per character', () => {
    const latin = estimateTokens('abcdefghij')
    const kanji = estimateTokens('日本語のテキストです')
    expect(kanji).toBeGreaterThan(latin)
    expect(kanji).toBe(10)
  })

  it('counts a mixed string without double counting', () => {
    expect(estimateTokens('日本語 abcd')).toBe(3 + Math.ceil(5 / 4))
  })

  it('counts Hangul as wide', () => {
    expect(estimateTokens('안녕하세요')).toBe(5)
  })

  it('never returns a fraction', () => {
    expect(Number.isInteger(estimateTokens('abc'))).toBe(true)
  })
})

describe('historyBudget', () => {
  /** The rest of the window is the reply, this turn's tools, and estimate error. */
  it('reserves headroom rather than spending the whole window', () => {
    expect(historyBudget(DEFAULT_CONTEXT_TOKENS)).toBeLessThan(DEFAULT_CONTEXT_TOKENS)
    expect(historyBudget(DEFAULT_CONTEXT_TOKENS)).toBeGreaterThan(0)
  })

  it('stays positive even for an absurdly small window', () => {
    expect(historyBudget(1)).toBeGreaterThan(0)
    expect(historyBudget(0)).toBeGreaterThan(0)
  })
})

describe('planHistory', () => {
  it('keeps everything that fits', () => {
    expect(planHistory([...turn(10), ...turn(10)], 1_000)).toEqual({ from: 0, trimmed: false })
  })

  it('reports nothing to do for an empty history', () => {
    expect(planHistory([], 1_000)).toEqual({ from: 0, trimmed: false })
  })

  it('drops the oldest turns first', () => {
    const messages = [...turn(100), ...turn(100), ...turn(100)]
    const plan = planHistory(messages, 250)

    expect(plan.trimmed).toBe(true)
    expect(plan.from).toBeGreaterThan(0)
    // Whatever survives still starts a turn.
    expect(messages[plan.from]?.role).toBe('user')
  })

  /**
   * Starting history on an assistant reply reads as though the model answered
   * a question nobody asked.
   */
  it('always resumes at a user message', () => {
    const messages = [...turn(100), ...turn(100), ...turn(100), ...turn(100)]
    for (const budget of [120, 210, 330, 450, 600]) {
      const plan = planHistory(messages, budget)
      expect(messages[plan.from]?.role).toBe('user')
    }
  })

  /** Sending nothing is a worse failure than sending one oversized turn. */
  it('keeps the final message even when it alone exceeds the budget', () => {
    const messages: Sized[] = [
      { role: 'user', tokens: 10 },
      { role: 'user', tokens: 10_000 },
    ]
    const plan = planHistory(messages, 100)

    expect(plan.from).toBe(1)
    expect(plan.trimmed).toBe(true)
  })

  it('handles a single message', () => {
    expect(planHistory([{ role: 'user', tokens: 5 }], 1_000)).toEqual({
      from: 0,
      trimmed: false,
    })
  })

  it('reports trimmed only when something was actually left out', () => {
    expect(planHistory([...turn(10)], 1_000).trimmed).toBe(false)
    expect(planHistory([...turn(500), ...turn(10)], 100).trimmed).toBe(true)
  })
})
