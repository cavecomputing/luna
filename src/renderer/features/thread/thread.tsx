import { useEffect, useRef } from 'react'
import type { Conversation } from '../../../shared/types.js'
import { Greeting } from './greeting.js'
import { Message } from './message.js'
import styles from './thread.module.css'

type Props = {
  chat: Conversation | undefined
}

export function Thread({ chat }: Props): React.JSX.Element {
  const end = useRef<HTMLDivElement>(null)
  const count = chat?.messages.length ?? 0

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [count, chat?.id])

  return (
    <div className={styles.scroll}>
      <div className={styles.inner}>
        {count === 0 && <Greeting />}

        {chat?.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        <div ref={end} />
      </div>
    </div>
  )
}
