import type { Conversation } from '../../../shared/types.js'
import { ChatGlyph } from '../../ui/chat-glyph.js'
import { relative } from '../../lib/time.js'
import styles from './chat-item.module.css'
import { cx } from '../../lib/cx.js'

type Props = {
  chat: Conversation
  active: boolean
  now: number
  onSelect: (id: string) => void
}

export function ChatItem({ chat, active, now, onSelect }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(styles.item, active && styles.active)}
      aria-current={active ? 'true' : undefined}
      onClick={() => {
        onSelect(chat.id)
      }}
    >
      <span className={styles.glyph}>
        <ChatGlyph icon={chat.icon} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{chat.title}</span>
        <span className={styles.when}>{relative(chat.updatedAt, now)}</span>
      </span>
    </button>
  )
}
