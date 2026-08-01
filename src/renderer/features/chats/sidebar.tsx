import type { Chats } from './use-chats.js'
import { ChatItem } from './chat-item.js'
import { IconButton } from '../../ui/icon-button.js'
import { SearchInput } from '../../ui/search-input.js'
import { Gear } from '../../ui/icons/gear.js'
import { Plus } from '../../ui/icons/plus.js'
import { useAppInfo } from '../../lib/use-app-info.js'
import styles from './sidebar.module.css'

type Props = {
  chats: Chats
  /** Frozen per render of the shell so every row formats against one clock. */
  now: number
  onSettings: () => void
}

export function Sidebar({ chats, now, onSettings }: Props): React.JSX.Element {
  const info = useAppInfo()

  return (
    <aside className={styles.sidebar}>
      <header className={styles.head}>
        <h1 className={styles.brand}>Chats</h1>
        <div className={styles.noDrag}>
          <IconButton label="New chat" variant="accent" onClick={chats.start}>
            <Plus />
          </IconButton>
        </div>
      </header>

      <div className={styles.search}>
        <SearchInput value={chats.query} onChange={chats.setQuery} placeholder="Search chats" />
      </div>

      <nav className={styles.list} aria-label="Conversations">
        {chats.visible.map((chat) => (
          <ChatItem
            key={chat.id}
            chat={chat}
            now={now}
            active={chat.id === chats.openId}
            onSelect={chats.setOpenId}
          />
        ))}

        {chats.visible.length === 0 && (
          <p className={styles.empty}>
            No chats match <span className={styles.term}>{chats.query}</span>
          </p>
        )}
      </nav>

      <footer className={styles.foot}>
        <button type="button" className={styles.settings} onClick={onSettings}>
          <Gear />
          Settings
        </button>
        {info?.ok === true && <p className={styles.version}>v{info.value.version}</p>}
      </footer>
    </aside>
  )
}
