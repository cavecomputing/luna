import type { Conversation } from '../../../shared/types.js'
import styles from './chat-item.module.css'
import { cx } from '../../lib/cx.js'
import { IconButton } from '../../ui/icon-button.js'
import { Pin } from '../../ui/icons/pin.js'
import { Trash } from '../../ui/icons/trash.js'

type Props = {
  chat: Conversation
  active: boolean
  onSelect: (id: string) => void
  onTogglePinned: (id: string) => void
  onDelete: (id: string) => void
}

export function ChatItem({
  chat,
  active,
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
        <span className={styles.title}>{chat.title}</span>
      </button>

      <span className={styles.actions}>
        <IconButton
          label={chat.pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
          size="xs"
          onClick={() => {
            onTogglePinned(chat.id)
          }}
        >
          <Pin size={12} />
        </IconButton>
        <IconButton
          label={`Delete ${chat.title}`}
          size="xs"
          onClick={() => {
            onDelete(chat.id)
          }}
        >
          <Trash size={12} />
        </IconButton>
      </span>
    </div>
  )
}
