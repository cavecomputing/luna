import { describe, expect, it } from 'vitest'
import { clampSidebarWidth } from './sidebar-width.js'

describe('clampSidebarWidth', () => {
  it('keeps pointer-driven widths within the usable sidebar range', () => {
    expect(clampSidebarWidth(120)).toBe(200)
    expect(clampSidebarWidth(312)).toBe(312)
    expect(clampSidebarWidth(520)).toBe(420)
  })
})
