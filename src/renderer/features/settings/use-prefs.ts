import { useCallback, useEffect, useState } from 'react'
import { defaultPrefs, type Prefs } from '../../../shared/prefs.js'

type State = {
  prefs: Prefs
  /** False until the first load lands, so inputs don't flash defaults. */
  ready: boolean
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void
}

/**
 * Reads prefs from main, and writes the whole object back on every change.
 * Main re-parses whatever arrives, so a stale field can't corrupt the file.
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
    return () => {
      live = false
    }
  }, [])

  const set = useCallback<State['set']>((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value }
      void window.luna.prefs.set(next)
      return next
    })
  }, [])

  return { prefs, ready, set }
}
