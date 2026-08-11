import { err, ok } from '../../shared/result.js'
import { closeSettings, openSettings } from '../window.js'
import { handle } from './bus.js'

export function register(): void {
  handle('settings:open', () => {
    openSettings()
    return ok(undefined)
  })
  handle('settings:close', (event) => {
    if (!closeSettings(event.sender)) {
      return err('settings/not-owner', 'only the Settings window can finish closing')
    }
    return ok(undefined)
  })
}
