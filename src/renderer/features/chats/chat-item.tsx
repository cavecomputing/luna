import type { Conversation } from '../../../shared/types.js'
import { ChatGlyph } from '../../ui/chat-glyph.js'
import { relative } from '../../lib/time.js'
import styles from './chat-item.module.css'
import { cx } from '../../lib/cx.js'
import { IconButton } from '../../ui/icon-button.js'
import { Pin } from '../../ui/icons/pin.js'
import { Trash } from '../../ui/icons/trash.js'

type Props = {
  chat: Conversation
  active: boolean
  now: number
  onSelect: (id: string) => void
  onTogglePinned: (id: string) => void
  onDelete: (id: string) => void
}

export function ChatItem({
  chat,
  active,
  now,
  onSelect,
  onTogglePinned,
  onDelete,
}: Props): React.JSX.Element {
  return (
    <div className={cx(styles.item, active && styles.active, chat.pinned && styles.pinned)}>
      <button
        type="button"
        className={styles.select}
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

      <span className={styles.actions}>
        <IconButton
          label={chat.pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
          size="sm"
          onClick={() => {
            onTogglePinned(chat.id)
          }}
        >
          <Pin size={14} />
        </IconButton>
        <IconButton
          label={`Delete ${chat.title}`}
          size="sm"
          onClick={() => {
            onDelete(chat.id)
          }}
        >
          <Trash size={14} />
        </IconButton>
      </span>
    </div>
  )
}
