import { useEffect, useRef, useState } from 'react'
import type { MessageStatus } from '../../../shared/types.js'

const STREAMING_MIN_CPS = 72
const STREAMING_MAX_CPS = 420
const SETTLED_MIN_CPS = 140
const SETTLED_MAX_CPS = 1_000

export function revealStep(
  backlog: number,
  elapsedMs: number,
  carry: number,
  settled: boolean,
): { count: number; carry: number } {
  if (backlog <= 0) return { count: 0, carry: 0 }
  const min = settled ? SETTLED_MIN_CPS : STREAMING_MIN_CPS
  const max = settled ? SETTLED_MAX_CPS : STREAMING_MAX_CPS
  const multiplier = settled ? 10 : 5
  const rate = Math.min(max, Math.max(min, min + backlog * multiplier))
  const budget = carry + (Math.max(0, elapsedMs) / 1_000) * rate
  const count = Math.min(backlog, Math.floor(budget))
  return { count, carry: count === backlog ? 0 : budget - count }
}

function reduceMotion(): boolean {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Decouples visible typing speed from uneven provider/network chunk sizes. */
export function useSmoothText(target: string, initialStatus: MessageStatus): string {
  const shouldAnimate = initialStatus === 'streaming' && !reduceMotion()
  const animate = useRef(shouldAnimate)
  const targetRef = useRef(target)
  const settledRef = useRef(initialStatus !== 'streaming')
  const [current, setCurrent] = useState(() => (shouldAnimate ? '' : target))
  const currentRef = useRef(current)
  const frame = useRef<number | undefined>(undefined)
  const last = useRef<number | undefined>(undefined)
  const carry = useRef(0)

  useEffect(() => {
    targetRef.current = target
    settledRef.current = initialStatus !== 'streaming'

    function tick(now: number): void {
      frame.current = undefined
      const wanted = targetRef.current
      const shown = currentRef.current

      if (!animate.current || !wanted.startsWith(shown)) {
        currentRef.current = wanted
        setCurrent(wanted)
        last.current = undefined
        carry.current = 0
        return
      }

      const backlog = wanted.length - shown.length
      if (backlog === 0) {
        last.current = undefined
        carry.current = 0
        return
      }

      last.current ??= now
      const step = revealStep(backlog, now - last.current, carry.current, settledRef.current)
      last.current = now
      carry.current = step.carry
      if (step.count > 0) {
        const next = wanted.slice(0, shown.length + step.count)
        currentRef.current = next
        setCurrent(next)
      }
      frame.current ??= requestAnimationFrame(tick)
    }

    if (currentRef.current !== targetRef.current) {
      frame.current ??= requestAnimationFrame(tick)
    }
  }, [target, initialStatus])

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return current
}
