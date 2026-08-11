export const DEFAULT_SIDEBAR_WIDTH = 264
export const MIN_SIDEBAR_WIDTH = 200
export const MAX_SIDEBAR_WIDTH = 420

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
