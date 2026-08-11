/** An intentional renderer shutdown must not reopen a window while Luna quits. */
export function needsRecovery(reason: string, quitting: boolean): boolean {
  return !quitting && reason !== 'clean-exit'
}
