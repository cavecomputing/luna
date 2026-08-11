import type { Conversation } from '../../../shared/types.js'
import styles from './chat-item.module.css'
import { cx } from '../../lib/cx.js'
import { IconButton } from '../../ui/icon-button.js'
import { Ellipsis } from '../../ui/icons/ellipsis.js'

type Props = {
  chat: Conversation
  active: boolean
  onSelect: (id: string) => void
}

export function ChatItem({
  chat,
  active,
  onSelect,
}: Props): React.JSX.Element {
  return (
    <div className={cx(styles.item, active && styles.active)}>
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
          label={`More options for ${chat.title}`}
          size="xs"
          onClick={() => {
            void window.luna.chats.menu(chat.id)
          }}
        >
          <Ellipsis size={14} />
        </IconButton>
      </span>
    </div>
  )
}
