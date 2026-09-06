import { describe, expect, it } from 'vitest'
import {
  MAX_STORED_TOOL_RESULT_CHARS,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TOOL_ITERATIONS,
  MAX_TOOL_RESULT_CHARS,
  toolKey,
} from './tools.js'

describe('toolKey', () => {
  /** Tool names are unique only within a server, so two can share one name. */
  it('separates the same tool name coming from different sources', () => {
    expect(toolKey('server-a', 'search')).not.toBe(toolKey('server-b', 'search'))
  })

  it('is stable for the same pair', () => {
    expect(toolKey('builtin', 'luna_echo')).toBe(toolKey('builtin', 'luna_echo'))
  })

  it('keeps the source and name readable in the key', () => {
    expect(toolKey('builtin', 'luna_echo')).toBe('builtin:luna_echo')
  })
})

describe('limits', () => {
  it('bounds a turn by both iterations and total calls', () => {
    expect(MAX_TOOL_ITERATIONS).toBeGreaterThan(0)
    // Several calls may come back per iteration, so the total has to be higher
    // or the per-iteration cap would never be the binding one.
    expect(MAX_TOOL_CALLS_PER_TURN).toBeGreaterThan(MAX_TOOL_ITERATIONS)
  })

  /**
   * A transcript row is read far more often than it is sent, so what is kept
   * is smaller than what one turn is allowed to carry.
   */
  it('stores less of a result than it sends to the model', () => {
    expect(MAX_STORED_TOOL_RESULT_CHARS).toBeLessThan(MAX_TOOL_RESULT_CHARS)
  })
})
