export const DEFAULT_SIDEBAR_WIDTH = 264

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 420

export function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
}
