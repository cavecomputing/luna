import { describe, expect, it } from 'vitest'
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, snapSidebarWidth } from './sidebar-width.js'

describe('clampSidebarWidth', () => {
  it('keeps pointer-driven widths within the usable sidebar range', () => {
    expect(clampSidebarWidth(120)).toBe(200)
    expect(clampSidebarWidth(312)).toBe(312)
    expect(clampSidebarWidth(520)).toBe(420)
  })

  it('snaps close pointer positions to the default width', () => {
    expect(snapSidebarWidth(DEFAULT_SIDEBAR_WIDTH - 10)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(snapSidebarWidth(DEFAULT_SIDEBAR_WIDTH + 10)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(snapSidebarWidth(DEFAULT_SIDEBAR_WIDTH + 11)).toBe(DEFAULT_SIDEBAR_WIDTH + 11)
  })
})
