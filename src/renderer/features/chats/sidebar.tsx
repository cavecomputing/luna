import type { Chats } from './use-chats.js'
import { ChatItem } from './chat-item.js'
import { IconButton } from '../../ui/icon-button.js'
import { Gear } from '../../ui/icons/gear.js'
import { Plus } from '../../ui/icons/plus.js'
import { Search } from '../../ui/icons/search.js'
import { useAppInfo } from '../../lib/use-app-info.js'
import styles from './sidebar.module.css'

type Props = {
  chats: Chats
  /** Frozen per render of the shell so every row formats against one clock. */
  now: number
  onSearchOpen: () => void
  onSettings: () => void
}

export function Sidebar({ chats, now, onSearchOpen, onSettings }: Props): React.JSX.Element {
  const info = useAppInfo()

  return (
    <aside className={styles.sidebar}>
      <header className={styles.head}>
        <h1 className={styles.brand}>Chats</h1>
        <div className={styles.actions}>
          <IconButton label="Search chats (Ctrl+F)" onClick={onSearchOpen}>
            <Search />
          </IconButton>
          <IconButton label="New chat" variant="accent" onClick={chats.start}>
            <Plus />
          </IconButton>
        </div>
      </header>

      <nav className={styles.list} aria-label="Conversations">
        {chats.visible.map((chat) => (
          <ChatItem
            key={chat.id}
            chat={chat}
            now={now}
            active={chat.id === chats.openId}
            onSelect={chats.setOpenId}
            onTogglePinned={chats.togglePinned}
            onDelete={chats.remove}
          />
        ))}

        {chats.visible.length === 0 && <p className={styles.empty}>No conversations yet</p>}
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
