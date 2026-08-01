import { useCallback, useEffect, useState } from 'react'
import { defaultPrefs, type Prefs } from '../../shared/prefs.js'

type State = {
  prefs: Prefs
  /** False until the first load lands, so inputs don't flash defaults. */
  ready: boolean
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void
}

/**
 * Reads prefs from main and stays subscribed.
 *
 * Lives in lib/ rather than a feature folder because both windows use it: the
 * Settings window writes, the main window reads, and neither may drift from the
 * other. Main broadcasts every change to every window, so a toggle flipped in
 * Settings lands here without a reload.
 */
export function usePrefs(): State {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true

    void window.luna.prefs.get().then((r) => {
      if (!live) return
      if (r.ok) setPrefs(r.value)
      setReady(true)
    })

    const stop = window.luna.onPrefs((next) => {
      setPrefs(next)
    })

    return () => {
      live = false
      stop()
    }
  }, [])

  const set = useCallback<State['set']>(
    (key, value) => {
      const next = { ...prefs, [key]: value }
      // Optimistic, so a textarea doesn't wait on a round trip per keystroke.
      // The broadcast confirms it; main is still the authority.
      setPrefs(next)

      void window.luna.prefs.set(next).then((r) => {
        // Nothing was stored, so don't keep showing it as though it was.
        if (!r.ok) setPrefs(prefs)
      })
    },
    [prefs],
  )

  return { prefs, ready, set }
}
