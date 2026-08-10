const FOLLOW_DISTANCE = 64

type ScrollPosition = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export function isNearBottom(position: ScrollPosition): boolean {
  return position.scrollHeight - position.scrollTop - position.clientHeight <= FOLLOW_DISTANCE
}
