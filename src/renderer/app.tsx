import { useEffect, useState } from 'react'
import { Sidebar } from './features/chats/sidebar.js'
import { useChats } from './features/chats/use-chats.js'
import { Composer } from './features/composer/composer.js'
import { ModeSwitch } from './features/mode/mode-switch.js'
import { Thread } from './features/thread/thread.js'
import { IconButton } from './ui/icon-button.js'
import { Collapse } from './ui/icons/collapse.js'
import styles from './app.module.css'
import { useNow } from './lib/use-now.js'
import { usePrefs } from './lib/use-prefs.js'
import { cx } from './lib/cx.js'
import { isSearchShortcut } from './features/chats/search-shortcut.js'
import { ChatSearch } from './features/chats/chat-search.js'

/**
 * Layout only. Every pane owns its own state; the shell just decides where
 * things sit and passes the conversation store down.
 */
export function App(): React.JSX.Element {
  const { prefs } = usePrefs()
  const chats = useChats(prefs.defaultMode)
  const [open, setOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const usesTrafficLights = window.luna.platform === 'darwin'

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isSearchShortcut(event)) {
        event.preventDefault()
        setSearchOpen(true)
      } else if (event.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [searchOpen])

  function closeSearch(): void {
    setSearchOpen(false)
  }

  // One ticking clock for the whole shell, so every row agrees.
  const now = useNow()

  return (
    <div className={styles.shell} data-platform={window.luna.platform}>
      {open && (
        <Sidebar
          chats={chats}
          now={now}
          onSearchOpen={() => {
            setSearchOpen(true)
          }}
          onSettings={() => {
            void window.luna.settings.open()
          }}
        />
      )}

      <main className={styles.pane}>
        <header className={cx(styles.top, !open && usesTrafficLights && styles.inset)}>
          <div className={styles.noDrag}>
            <IconButton
              label={open ? 'Hide sidebar' : 'Show sidebar'}
              onClick={() => {
                setOpen((v) => !v)
              }}
            >
              <span className={cx(!open && styles.flip)}>
                <Collapse />
              </span>
            </IconButton>
          </div>

          <div className={styles.noDrag}>
            <ModeSwitch value={chats.currentMode} onChange={chats.setMode} />
          </div>
        </header>

        <Thread chat={chats.open} />

        <Composer
          onSend={chats.send}
          onCancel={chats.cancel}
          streaming={chats.streamingMessage !== undefined}
          notice={chats.error}
        />
      </main>

      {searchOpen && (
        <ChatSearch
          chats={chats.all}
          now={now}
          onClose={closeSearch}
          onSelect={(id) => {
            chats.setOpenId(id)
            closeSearch()
          }}
        />
      )}
    </div>
  )
}
