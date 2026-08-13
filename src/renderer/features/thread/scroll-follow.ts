const FOLLOW_DISTANCE = 64
const MAX_FOLLOW_STEP = 12

type ScrollPosition = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export function isNearBottom(position: ScrollPosition): boolean {
  return position.scrollHeight - position.scrollTop - position.clientHeight <= FOLLOW_DISTANCE
}

/**
 * Advances only after content crosses the viewport edge. Capping each frame
 * keeps a growing response visually anchored without snapping to its end.
 */
export function followStep(position: ScrollPosition): number | undefined {
  const bottom = Math.max(0, position.scrollHeight - position.clientHeight)
  const hidden = bottom - position.scrollTop
  if (hidden <= 0) return undefined
  return position.scrollTop + Math.min(MAX_FOLLOW_STEP, Math.max(1, hidden / 4))
}
