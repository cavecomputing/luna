import type { WebContents } from 'electron'
import { err, ok, type Result } from '../../shared/result.js'
import { closeSettings, openSettings } from '../window.js'
import { handle } from './bus.js'

export function open(): Result<undefined> {
  openSettings()
  return ok(undefined)
}

/**
 * Settings closes itself, so the request has to prove it came from that window.
 * Any other renderer asking would close a window it does not own.
 */
export function close(sender: WebContents): Result<undefined> {
  if (!closeSettings(sender)) {
    return err('settings/not-owner', 'only the Settings window can finish closing')
  }
  return ok(undefined)
}

export function register(): void {
  handle('settings:open', () => open())
  handle('settings:close', (event) => close(event.sender))
}
