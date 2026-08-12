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
  const response = useRef<HTMLElement>(null)
  const [following, setFollowing] = useState(true)
  const count = chat?.messages.length ?? 0
  // Messages past this count arrived after mount, so they get an entrance.
  // History loaded from disk mounts with the thread and stays still.
  const [mountedCount] = useState(count)
  const streamingId = chat?.messages.findLast(
    (message) => message.role === 'assistant' && message.status === 'streaming',
  )?.id
  const latest = chat?.messages.at(-1)
  const activeAnchorId = latest?.role === 'assistant' ? latest.id : undefined

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [chat?.id])

  // Put a new response at the top once, then leave scrolling to the reader.
  useEffect(() => {
    if (streamingId === undefined) return
    const scroller = scroll.current
    if (scroller !== null) {
      scroller.style.setProperty('--generation-height', `${String(scroller.clientHeight)}px`)
    }
    response.current?.scrollIntoView({ block: 'start' })
  }, [streamingId])

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
              {...(message.id === streamingId ? { anchorRef: response } : {})}
              anchored={message.id === activeAnchorId}
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
