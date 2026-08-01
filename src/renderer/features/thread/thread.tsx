import { useEffect, useRef } from 'react'
import type { Conversation, Suggestion } from '../../../shared/types.js'
import { Greeting } from './greeting.js'
import { Message } from './message.js'
import { Suggestions } from './suggestions.js'
import styles from './thread.module.css'

type Props = {
  chat: Conversation | undefined
  suggestions: Suggestion[]
  onPickSuggestion: (label: string) => void
}

export function Thread({ chat, suggestions, onPickSuggestion }: Props): React.JSX.Element {
  const end = useRef<HTMLDivElement>(null)
  const count = chat?.messages.length ?? 0

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [count, chat?.id])

  if (chat === undefined) {
    return (
      <div className={styles.scroll}>
        <div className={styles.inner}>
          <Greeting />
        </div>
      </div>
    )
  }

  const last = chat.messages.at(-1)
  const showSuggestions = last?.role === 'assistant'

  return (
    <div className={styles.scroll}>
      <div className={styles.inner}>
        {chat.messages.length === 0 && <Greeting />}

        {chat.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        {showSuggestions && <Suggestions items={suggestions} onPick={onPickSuggestion} />}

        <div ref={end} />
      </div>
    </div>
  )
}
