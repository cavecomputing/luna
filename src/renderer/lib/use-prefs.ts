import { useCallback, useEffect, useRef, useState } from 'react'
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
  const current = useRef(defaultPrefs)

  const adopt = useCallback((next: Prefs): void => {
    current.current = next
    setPrefs(next)
  }, [])

  useEffect(() => {
    let live = true

    void window.luna.prefs.get().then((r) => {
      if (!live) return
      if (r.ok) adopt(r.value)
      setReady(true)
    })

    const stop = window.luna.onPrefs((next) => {
      adopt(next)
    })

    return () => {
      live = false
      stop()
    }
  }, [adopt])

  const set = useCallback<State['set']>(
    (key, value) => {
      const next = { ...current.current, [key]: value }
      // Optimistic, so a textarea doesn't wait on a round trip per keystroke.
      // The broadcast confirms it; main is still the authority.
      adopt(next)

      void window.luna.prefs.set(next).then((r) => {
        if (r.ok) return
        // Nothing was stored. Re-read main instead of rolling back to a stale
        // render closure that may predate another window's change.
        void window.luna.prefs.get().then((latest) => {
          if (latest.ok) adopt(latest.value)
        })
      })
    },
    [adopt],
  )

  return { prefs, ready, set }
}
