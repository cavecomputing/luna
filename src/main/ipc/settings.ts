import { ok } from '../../shared/result.js'
import { openSettings } from '../window.js'
import { handle } from './bus.js'

export function register(): void {
  handle('settings:open', () => {
    openSettings()
    return ok(undefined)
  })
}
