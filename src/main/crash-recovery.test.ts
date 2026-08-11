import { describe, expect, it } from 'vitest'
import { needsRecovery } from './crash-recovery.js'

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
