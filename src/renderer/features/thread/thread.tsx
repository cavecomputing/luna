import { useEffect, useRef, useState } from 'react'
import type { Conversation } from '../../../shared/types.js'
import { Greeting } from './greeting.js'
import { Message } from './message.js'
import styles from './thread.module.css'
import { isNearBottom } from './scroll-follow.js'

type Props = {
  chat: Conversation | undefined
}

export function Thread({ chat }: Props): React.JSX.Element {
  const scroll = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const count = chat?.messages.length ?? 0
  // Messages past this count arrived after mount, so they get an entrance.
  // History loaded from disk mounts with the thread and stays still.
  const [mountedCount] = useState(count)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [chat?.id])

  // New messages never move the view — the reader scrolls, or clicks the
  // jump button, which appears once new content lifts the bottom out of reach.
  useEffect(() => {
    const element = scroll.current
    if (element !== null) setFollowing(isNearBottom(element))
  }, [count])

  return (
    <div className={styles.thread}>
      <div
        ref={scroll}
        className={styles.scroll}
        onScroll={() => {
          const element = scroll.current
          if (element !== null) setFollowing(isNearBottom(element))
        }}
      >
        <div className={styles.inner}>
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
            setFollowing(true)
            end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  )
}
