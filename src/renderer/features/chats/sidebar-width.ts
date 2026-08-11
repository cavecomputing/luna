import { defaultPrefs, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '../../../shared/prefs.js'

export const DEFAULT_SIDEBAR_WIDTH = defaultPrefs.sidebarWidth
export const MIN_SIDEBAR_WIDTH = SIDEBAR_MIN_WIDTH
export const MAX_SIDEBAR_WIDTH = SIDEBAR_MAX_WIDTH

const SNAP_DISTANCE = 10

export function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
}

export function snapSidebarWidth(width: number): number {
  const clamped = clampSidebarWidth(width)
  return Math.abs(clamped - DEFAULT_SIDEBAR_WIDTH) <= SNAP_DISTANCE
    ? DEFAULT_SIDEBAR_WIDTH
    : clamped
}
