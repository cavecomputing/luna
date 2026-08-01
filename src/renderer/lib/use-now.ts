import { useEffect, useState } from 'react'

const HALF_MINUTE = 30_000

/**
 * A clock the render can read.
 *
 * Calling Date.now() during render is impure and, worse, freezes relative
 * timestamps at whatever they were when the component last happened to
 * re-render. Ticking it here keeps "Just now" from lingering for an hour.
 */
export function useNow(everyMs: number = HALF_MINUTE): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, everyMs)
    return () => {
      clearInterval(id)
    }
  }, [everyMs])

  return now
}
