export const AUTO_RECOVERY_WINDOW_MS = 10_000

/** An intentional renderer shutdown must not reopen a window while Luna quits. */
export function needsRecovery(reason: string, quitting: boolean): boolean {
  return !quitting && reason !== 'clean-exit'
}

/** A rapid second failure falls back to a stable page instead of reloading forever. */
export function canAutoRecover(previous: number | undefined, now: number): boolean {
  return previous === undefined || now - previous >= AUTO_RECOVERY_WINDOW_MS
}
