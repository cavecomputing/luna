const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * Sidebar timestamps. Takes `now` rather than reading the clock so callers
 * stay deterministic and tests need no fake timers.
 */
export function relative(at: number, now: number): string {
  const ms = now - at
  if (ms < MINUTE) return 'Just now'
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'min')
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour')
  if (ms < 2 * DAY) return 'Yesterday'
  if (ms < WEEK) return plural(Math.floor(ms / DAY), 'day')
  return plural(Math.floor(ms / WEEK), 'week')
}

function plural(n: number, unit: string): string {
  return `${String(n)} ${unit}${n === 1 ? '' : 's'} ago`
}

/** Wall-clock time on a message, e.g. "10:24 AM". */
export function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}
