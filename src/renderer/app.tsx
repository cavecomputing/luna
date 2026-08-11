import { useEffect, useRef, useState } from 'react'
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
import { CommandPalette } from './features/commands/command-palette.js'
import { matchesShortcutKey } from '../shared/keyboard-shortcuts.js'

/**
 * Layout only. Every pane owns its own state; the shell just decides where
 * things sit and passes the conversation store down.
 */
export function App(): React.JSX.Element {
  const { prefs } = usePrefs()
  const chats = useChats(prefs.defaultMode)
  const [open, setOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const usesTrafficLights = window.luna.platform === 'darwin'
  const startChat = useRef(chats.start)

  useEffect(() => {
    startChat.current = chats.start
  }, [chats.start])

  useEffect(() => {
    const offNewChat = window.luna.onNewChat(() => {
      setSearchOpen(false)
      setPaletteOpen(false)
      void startChat.current()
    })
    const offPalette = window.luna.onCommandPalette(() => {
      setSearchOpen(false)
      setPaletteOpen(true)
    })
    return () => {
      offNewChat()
      offPalette()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isSearchShortcut(event)) {
        event.preventDefault()
        setPaletteOpen(false)
        setSearchOpen(true)
      } else if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        matchesShortcutKey('close', event.key, event.code, event.shiftKey) &&
        (searchOpen || paletteOpen)
      ) {
        setSearchOpen(false)
        setPaletteOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [paletteOpen, searchOpen])

  function closeSearch(): void {
    setSearchOpen(false)
  }

  // One ticking clock for the whole shell, so every row agrees.
  const now = useNow()
  const sidebarButton = (
    <IconButton
      label={open ? 'Hide sidebar' : 'Show sidebar'}
      variant="soft"
      onClick={() => {
        setOpen((value) => !value)
      }}
    >
      <Collapse />
    </IconButton>
  )

  return (
    <div className={styles.shell} data-platform={window.luna.platform}>
      {open && (
        <Sidebar
          chats={chats}
          collapse={usesTrafficLights ? sidebarButton : null}
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
        <header className={cx(styles.top, !usesTrafficLights && styles.withInlineToggle)}>
          {usesTrafficLights && !open && (
            <div className={styles.trafficToggle}>{sidebarButton}</div>
          )}
          {!usesTrafficLights && <div className={styles.noDrag}>{sidebarButton}</div>}

          <div className={styles.noDrag}>
            <ModeSwitch value={chats.currentMode} onChange={chats.setMode} />
          </div>
        </header>

        <Thread key={chats.openId ?? 'empty-thread'} chat={chats.open} />

        <Composer
          key={chats.openId ?? 'new-chat'}
          onSend={chats.send}
          conversationId={chats.openId}
          onEnsureConversation={chats.ensure}
          onCancel={chats.cancel}
          streaming={chats.streamingMessage !== undefined}
          initialDraft={chats.open?.draft}
          onDraftChange={chats.setDraft}
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

      {paletteOpen && (
        <CommandPalette
          onClose={() => {
            setPaletteOpen(false)
          }}
        />
      )}
    </div>
  )
}
