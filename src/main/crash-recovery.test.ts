import { describe, expect, it } from 'vitest'
import {
  AUTO_RECOVERY_WINDOW_MS,
  canAutoRecover,
  needsRecovery,
} from './crash-recovery.js'

describe('needsRecovery', () => {
  it('recovers an abnormal renderer exit', () => {
    expect(needsRecovery('crashed', false)).toBe(true)
    expect(needsRecovery('oom', false)).toBe(true)
  })

  it('ignores clean exits and application shutdown', () => {
    expect(needsRecovery('clean-exit', false)).toBe(false)
    expect(needsRecovery('crashed', true)).toBe(false)
  })
})

describe('canAutoRecover', () => {
  it('automatically recovers the first renderer failure', () => {
    expect(canAutoRecover(undefined, 1_000)).toBe(true)
  })

  it('stops a rapid reload loop but allows a later recovery', () => {
    expect(canAutoRecover(1_000, 1_000 + AUTO_RECOVERY_WINDOW_MS - 1)).toBe(false)
    expect(canAutoRecover(1_000, 1_000 + AUTO_RECOVERY_WINDOW_MS)).toBe(true)
  })
})
