import { useEffect, useRef, useState } from 'react'
import type { Conversation } from '../../../shared/types.js'
import { Greeting } from './greeting.js'
import { Message } from './message.js'
import styles from './thread.module.css'
import { followStep, isNearBottom } from './scroll-follow.js'

type Props = {
  chat: Conversation | undefined
}

export function Thread({ chat }: Props): React.JSX.Element {
  const scroll = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const follows = useRef(true)
  const moving = useRef(false)
  const lastTop = useRef(0)
  const count = chat?.messages.length ?? 0
  // Messages past this count arrived after mount, so they get an entrance.
  // History loaded from disk mounts with the thread and stays still.
  const [mountedCount] = useState(count)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
    lastTop.current = scroll.current?.scrollTop ?? 0
  }, [chat?.id])

  // Follow a growing response one small frame at a time. The loop starts only
  // when the content's bottom crosses the viewport and stops as soon as the
  // reader scrolls upward.
  useEffect(() => {
    const element = scroll.current
    const content = inner.current
    if (element === null || content === null || typeof ResizeObserver === 'undefined') return
    let frame: number | undefined

    const tick = (): void => {
      frame = undefined
      if (!follows.current) {
        moving.current = false
        return
      }
      const next = followStep(element)
      if (next === undefined) {
        moving.current = false
        return
      }
      lastTop.current = next
      element.scrollTop = next
      frame = requestAnimationFrame(tick)
    }
    const observer = new ResizeObserver(() => {
      if (follows.current && frame === undefined) {
        moving.current = true
        frame = requestAnimationFrame(tick)
      }
    })
    observer.observe(content)
    return () => {
      observer.disconnect()
      moving.current = false
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [])

  function setFollow(value: boolean): void {
    follows.current = value
    setFollowing(value)
  }

  return (
    <div className={styles.thread}>
      <div
        ref={scroll}
        className={styles.scroll}
        onScroll={() => {
          const element = scroll.current
          if (element === null) return
          if (element.scrollTop < lastTop.current - 1) setFollow(false)
          else if (isNearBottom(element)) setFollow(true)
          else if (!moving.current) setFollow(false)
          lastTop.current = element.scrollTop
        }}
      >
        <div ref={inner} className={styles.inner}>
          {count === 0 && <Greeting />}

          {chat?.messages.map((message, index) => (
            <Message
              key={message.id}
              message={message}
              conversationId={chat.id}
              fresh={index >= mountedCount}
            />
          ))}

          <div ref={end} />
        </div>
      </div>

      {!following && count > 0 && (
        <button
          type="button"
          className={styles.latest}
          onClick={() => {
            setFollow(true)
            end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  )
}
