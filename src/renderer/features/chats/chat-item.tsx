import { useRef, useState } from 'react'
import type { Conversation } from '../../../shared/types.js'
import styles from './chat-item.module.css'
import { cx } from '../../lib/cx.js'
import { IconButton } from '../../ui/icon-button.js'
import { Ellipsis } from '../../ui/icons/ellipsis.js'

type Props = {
  chat: Conversation
  active: boolean
  renaming: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onCancelRename: () => void
}

type RenameProps = Pick<Props, 'chat' | 'onRename' | 'onCancelRename'>

function RenameInput({ chat, onRename, onCancelRename }: RenameProps): React.JSX.Element {
  const [value, setValue] = useState(chat.title)
  const finished = useRef(false)

  function finish(): void {
    if (finished.current) return
    finished.current = true
    const title = value.trim()
    if (title === '') onCancelRename()
    else onRename(chat.id, title)
  }

  return (
    <form
      className={styles.rename}
      onSubmit={(event) => {
        event.preventDefault()
        finish()
      }}
    >
      <input
        className={styles.renameInput}
        aria-label={`Rename ${chat.title}`}
        value={value}
        maxLength={200}
        autoFocus
        onFocus={(event) => {
          event.currentTarget.select()
        }}
        onBlur={finish}
        onChange={(event) => {
          setValue(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          finished.current = true
          onCancelRename()
        }}
      />
    </form>
  )
}

export function ChatItem({
  chat,
  active,
  renaming,
  onSelect,
  onRename,
  onCancelRename,
}: Props): React.JSX.Element {
  return (
    <div className={cx(styles.item, active && styles.active)}>
      {renaming ? (
        <RenameInput chat={chat} onRename={onRename} onCancelRename={onCancelRename} />
      ) : (
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
      )}

      {!renaming && <span className={styles.actions}>
        <IconButton
          label={`More options for ${chat.title}`}
          size="xs"
          onClick={() => {
            void window.luna.chats.menu(chat.id)
          }}
        >
          <Ellipsis size={14} />
        </IconButton>
      </span>}
    </div>
  )
}
