import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './features/chats/sidebar.js'
import { type Chats, useChats } from './features/chats/use-chats.js'
import { Composer } from './features/composer/composer.js'
import { ModeSwitch } from './features/mode/mode-switch.js'
import { useModels } from './features/mode/use-models.js'
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
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  snapSidebarWidth,
} from './features/chats/sidebar-width.js'

type ConversationSurfaceProps = {
  chats: Chats
}

/** Remount conversation-local state without giving adjacent siblings duplicate keys. */
export function ConversationSurface({ chats }: ConversationSurfaceProps): React.JSX.Element {
  const conversationKey = chats.openId ?? 'empty'
  return (
    <>
      <Thread key={`thread:${conversationKey}`} chat={chats.open} />

      <Composer
        key={`composer:${conversationKey}`}
        onSend={chats.send}
        conversationId={chats.openId}
        onEnsureConversation={chats.ensure}
        onCancel={chats.cancel}
        streaming={chats.streamingMessage !== undefined}
        initialDraft={chats.open?.draft}
        onDraftChange={chats.setDraft}
        notice={chats.error}
      />
    </>
  )
}

/**
 * Layout only. Every pane owns its own state; the shell just decides where
 * things sit and passes the conversation store down.
 */
export function App(): React.JSX.Element {
  const { prefs, set: setPref } = usePrefs()
  const chats = useChats(prefs.defaultMode)
  const models = useModels()
  const [open, setOpen] = useState(true)
  const [resizeWidth, setResizeWidth] = useState<number>()
  const [isResizing, setIsResizing] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const usesTrafficLights = window.luna.platform === 'darwin'
  const placesToggleInSidebar = usesTrafficLights || window.luna.platform === 'win32'
  const showsInlineToggle = !placesToggleInSidebar || (!open && !usesTrafficLights)
  const startChat = useRef(chats.start)
  const currentMode = useRef(chats.currentMode)
  const changeMode = useRef(chats.setMode)
  const widthRef = useRef(DEFAULT_SIDEBAR_WIDTH)
  const sidebarWidth = resizeWidth ?? clampSidebarWidth(prefs.sidebarWidth)

  useEffect(() => {
    startChat.current = chats.start
    currentMode.current = chats.currentMode
    changeMode.current = chats.setMode
  }, [chats.currentMode, chats.setMode, chats.start])

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
    const offToggleSidebar = window.luna.onToggleSidebar(() => {
      setOpen((value) => !value)
    })
    const offToggleMode = window.luna.onToggleMode(() => {
      changeMode.current(currentMode.current === 'fast' ? 'expert' : 'fast')
    })
    return () => {
      offNewChat()
      offPalette()
      offToggleSidebar()
      offToggleMode()
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

  useEffect(() => {
    if (window.luna.platform !== 'win32') return
    const hasDialog = searchOpen || paletteOpen
    void window.luna.app.setModal(hasDialog)
    return () => {
      if (hasDialog) void window.luna.app.setModal(false)
    }
  }, [paletteOpen, searchOpen])

  function closeSearch(): void {
    setSearchOpen(false)
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    widthRef.current = sidebarWidth
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }

  function resize(event: React.PointerEvent<HTMLDivElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const width = snapSidebarWidth(event.clientX)
    widthRef.current = width
    setResizeWidth(width)
  }

  function stopResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsResizing(false)
    setPref('sidebarWidth', widthRef.current)
    setResizeWidth(undefined)
  }

  function resizeWithKeys(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Home') {
      event.preventDefault()
      setPref('sidebarWidth', DEFAULT_SIDEBAR_WIDTH)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? 24 : 8
    const width = clampSidebarWidth(sidebarWidth + (event.key === 'ArrowLeft' ? -step : step))
    setPref('sidebarWidth', width)
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
    <div
      className={styles.shell}
      data-platform={window.luna.platform}
      data-resizing={isResizing ? 'true' : undefined}
    >
      <div
        className={cx(styles.side, !open && styles.sideClosed, isResizing && styles.sideResizing)}
        style={{ width: open ? sidebarWidth : 0 }}
        inert={!open}
      >
        <Sidebar
          chats={chats}
          collapse={placesToggleInSidebar ? sidebarButton : null}
          width={sidebarWidth}
          onSearchOpen={() => {
            setSearchOpen(true)
          }}
          onSettings={() => {
            void window.luna.settings.open()
          }}
        />
      </div>

      {open && (
        <div
          className={styles.resize}
          style={{ left: sidebarWidth - 4 }}
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          aria-valuetext={
            sidebarWidth === DEFAULT_SIDEBAR_WIDTH
              ? `${String(DEFAULT_SIDEBAR_WIDTH)} pixels, default width`
              : `${String(Math.round(sidebarWidth))} pixels`
          }
          data-snapped={sidebarWidth === DEFAULT_SIDEBAR_WIDTH ? 'true' : undefined}
          title="Drag to resize; double-click or press Home to reset"
          tabIndex={0}
          onDoubleClick={() => {
            setPref('sidebarWidth', DEFAULT_SIDEBAR_WIDTH)
          }}
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onLostPointerCapture={() => {
            setIsResizing(false)
          }}
          onKeyDown={resizeWithKeys}
        />
      )}

      <main className={styles.pane}>
        <header className={cx(styles.top, showsInlineToggle && styles.withInlineToggle)}>
          {usesTrafficLights && !open && (
            <div className={styles.trafficToggle}>{sidebarButton}</div>
          )}
          {!usesTrafficLights && (!placesToggleInSidebar || !open) && (
            <div className={styles.noDrag}>{sidebarButton}</div>
          )}

          <div className={styles.noDrag}>
            <ModeSwitch value={chats.currentMode} models={models} onChange={chats.setMode} />
          </div>
        </header>

        <ConversationSurface chats={chats} />
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
