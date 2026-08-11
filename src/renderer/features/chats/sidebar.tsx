import type { Chats } from './use-chats.js'
import { shortcutKeys } from '../../../shared/keyboard-shortcuts.js'
import { ChatItem } from './chat-item.js'
import { IconButton } from '../../ui/icon-button.js'
import { Gear } from '../../ui/icons/gear.js'
import { Plus } from '../../ui/icons/plus.js'
import { Search } from '../../ui/icons/search.js'
import styles from './sidebar.module.css'

type Props = {
  chats: Chats
  collapse: React.ReactNode | null
  width: number
  onSearchOpen: () => void
  onSettings: () => void
}

export function Sidebar({
  chats,
  collapse,
  width,
  onSearchOpen,
  onSettings,
}: Props): React.JSX.Element {
  const searchKeys = shortcutKeys('search', window.luna.platform)
  const searchLabel = searchKeys.join(window.luna.platform === 'darwin' ? '' : '+')

  return (
    <aside className={styles.sidebar} style={{ width }}>
      <header className={styles.head}>
        {collapse !== null && <div className={styles.collapse}>{collapse}</div>}
        <div className={styles.actions}>
          <IconButton label={`Search chats (${searchLabel})`} onClick={onSearchOpen}>
            <Search />
          </IconButton>
          <IconButton label="New chat" variant="accent" onClick={() => { void chats.start() }}>
            <Plus />
          </IconButton>
        </div>
      </header>

      <nav className={styles.list} aria-label="Conversations">
        {chats.visible.map((chat) => (
          <ChatItem
            key={chat.id}
            chat={chat}
            active={chat.id === chats.openId}
            onSelect={chats.setOpenId}
          />
        ))}

        {chats.visible.length === 0 && <p className={styles.empty}>No conversations yet</p>}
      </nav>

      <footer className={styles.foot}>
        <button type="button" className={styles.settings} onClick={onSettings}>
          <Gear />
          Settings
        </button>
      </footer>
    </aside>
  )
}
