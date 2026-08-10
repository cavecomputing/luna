import { useEffect, useState } from 'react'
import type { Message as Msg } from '../../../shared/types.js'
import { clock } from '../../lib/time.js'
import { Markdown } from './markdown.js'
import { Avatar } from '../../ui/avatar.js'
import styles from './message.module.css'
import { cx } from '../../lib/cx.js'
import { useSmoothText } from './use-smooth-text.js'

type Props = {
  message: Msg
  onGrow: () => void
}

export function Message({ message, onGrow }: Props): React.JSX.Element {
  const mine = message.role === 'user'
  const [incoming] = useState(() => !mine && message.status === 'streaming')
  const fallback =
    message.text === '' && message.status === 'error'
      ? 'Response interrupted. Try again.'
      : message.text === '' && message.status === 'cancelled'
        ? 'Stopped'
        : message.text
  const visibleText = useSmoothText(fallback, message.status)
  const visibleReasoning = useSmoothText(message.reasoning ?? '', message.status)
  const waiting =
    !mine &&
    message.status === 'streaming' &&
    visibleText === '' &&
    visibleReasoning === ''

  useEffect(() => {
    onGrow()
  }, [visibleText, visibleReasoning, onGrow])

  return (
    <article
      className={cx(styles.row, mine ? styles.mine : styles.theirs, incoming && styles.incoming)}
      onContextMenu={(event) => {
        event.preventDefault()
        void window.luna.messages.menu(message.id)
      }}
    >
      {!mine && (
        <div className={styles.avatar}>
          <Avatar size={28} />
        </div>
      )}

      <div className={styles.bubble}>
        <div className={styles.body}>
          {/* Blocks are derived from immutable text and never reorder, so
              position is a stable identity here. */}
          {waiting && (
            <span className={styles.thinking} aria-label="Luna is responding">
              <i />
              <i />
              <i />
            </span>
          )}
          {!mine && visibleReasoning !== '' && (
            <details
              className={styles.reasoning}
              open={message.status === 'streaming' && visibleText === ''}
            >
              <summary>
                {message.status === 'streaming' && visibleText === ''
                  ? 'Thinking…'
                  : 'Thinking'}
              </summary>
              <div className={styles.reasoningBody}>
                <Markdown text={visibleReasoning} />
              </div>
            </details>
          )}
          <Markdown text={visibleText} />
        </div>
        {!mine && message.status === 'error' && message.text !== '' && (
          <p className={styles.interrupted}>Response interrupted</p>
        )}
        {!mine && message.status === 'cancelled' && message.text !== '' && (
          <p className={styles.interrupted}>Stopped</p>
        )}
        <time className={styles.when} dateTime={new Date(message.at).toISOString()}>
          {clock(message.at)}
        </time>
      </div>
    </article>
  )
}
