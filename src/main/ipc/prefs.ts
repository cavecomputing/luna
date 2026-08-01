import { parsePrefs, type Prefs } from '../../shared/prefs.js'
import { ok, type Result } from '../../shared/result.js'
import * as prefs from '../prefs.js'
import { handle } from './bus.js'

/**
 * Whatever the renderer sends is untrusted, so it goes through the same parser
 * as the file on disk before anything is written.
 */
export function clean(input: unknown): Result<Prefs> {
  return ok(parsePrefs(input))
}

export function register(): void {
  handle('prefs:get', async () => ok(await prefs.load()))

  handle('prefs:set', async (_event, req) => {
    const parsed = clean(req)
    if (!parsed.ok) return parsed
    const saved = await prefs.save(parsed.value)
    prefs.applyTheme(saved)
    return ok(saved)
  })
}
