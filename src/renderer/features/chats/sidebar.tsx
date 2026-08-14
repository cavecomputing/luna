import type { Chats } from './use-chats.js'
import { shortcutKeys } from '../../../shared/keyboard-shortcuts.js'
import { ChatItem } from './chat-item.js'
import { IconButton } from '../../ui/icon-button.js'
import { Gear } from '../../ui/icons/gear.js'
import { Plus } from '../../ui/icons/plus.js'
import { Search } from '../../ui/icons/search.js'
import { groupChats } from './filter.js'
import type { Conversation } from '../../../shared/types.js'
import styles from './sidebar.module.css'

type GroupProps = {
  id: string
  label: string
  chats: Conversation[]
  openId: string | undefined
  renameId: string | undefined
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onCancelRename: () => void
}

function ChatGroup({
  id,
  label,
  chats,
  openId,
  renameId,
  onSelect,
  onRename,
  onCancelRename,
}: GroupProps): React.JSX.Element {
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h2 className={styles.groupLabel} id={id}>{label}</h2>
      <div className={styles.items}>
        {chats.map((chat) => (
          <ChatItem
            key={chat.id}
            chat={chat}
            active={chat.id === openId}
            renaming={chat.id === renameId}
            onSelect={onSelect}
            onRename={onRename}
            onCancelRename={onCancelRename}
          />
        ))}
      </div>
    </section>
  )
}

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
  const groups = groupChats(chats.visible)

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
        {groups.pinned.length > 0 && (
          <ChatGroup
            id="pinned-conversations"
            label="Pinned"
            chats={groups.pinned}
            openId={chats.openId}
            renameId={chats.renameId}
            onSelect={chats.openChat}
            onRename={chats.rename}
            onCancelRename={chats.cancelRename}
          />
        )}

        {groups.recent.length > 0 && (
          <ChatGroup
            id="recent-conversations"
            label="Recent"
            chats={groups.recent}
            openId={chats.openId}
            renameId={chats.renameId}
            onSelect={chats.openChat}
            onRename={chats.rename}
            onCancelRename={chats.cancelRename}
          />
        )}

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
