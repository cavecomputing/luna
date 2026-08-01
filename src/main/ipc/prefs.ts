import { parsePrefs, type Prefs } from '../../shared/prefs.js'
import { ok, type Result } from '../../shared/result.js'
import * as prefs from '../prefs.js'
import { broadcast, handle } from './bus.js'

/**
 * Whatever the renderer sends is untrusted, so it goes through the same parser
 * as the rows on disk before anything is written.
 */
export function clean(input: unknown): Result<Prefs> {
  return ok(parsePrefs(input))
}

type Deps = {
  save: (prefs: Prefs) => Prefs
  applyTheme: (prefs: Prefs) => void
  /** Tells every window, not just the one that asked. */
  notify: (prefs: Prefs) => void
}

/**
 * The body of prefs:set as a plain function, so a test can prove the broadcast
 * fires and carries the stored value without an Electron window in sight.
 *
 * Order matters: store, then apply side effects, then announce. Nothing is
 * announced that wasn't written.
 */
export function applySet(input: unknown, deps: Deps): Result<Prefs> {
  const parsed = clean(input)
  if (!parsed.ok) return parsed

  const saved = deps.save(parsed.value)
  deps.applyTheme(saved)
  deps.notify(saved)
  return ok(saved)
}

export function register(): void {
  handle('prefs:get', () => ok(prefs.load()))

  handle('prefs:set', (_event, req) =>
    applySet(req, {
      save: prefs.save,
      applyTheme: prefs.applyTheme,
      notify: (next) => {
        broadcast('prefs:changed', next)
      },
    }),
  )
}
