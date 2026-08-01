import { useState } from 'react'
import { Sidebar } from './features/chats/sidebar.js'
import { useChats } from './features/chats/use-chats.js'
import { Composer } from './features/composer/composer.js'
import { ModeSwitch } from './features/mode/mode-switch.js'
import { Thread } from './features/thread/thread.js'
import { IconButton } from './ui/icon-button.js'
import { Collapse } from './ui/icons/collapse.js'
import { demoChats, demoSuggestions } from './data/demo.js'
import styles from './app.module.css'
import { useNow } from './lib/use-now.js'
import { cx } from './lib/cx.js'

/**
 * Layout only. Every pane owns its own state; the shell just decides where
 * things sit and passes the conversation store down.
 */
export function App(): React.JSX.Element {
  const chats = useChats(demoChats)
  const [open, setOpen] = useState(true)
  const [seed, setSeed] = useState<string>()

  // One ticking clock for the whole shell, so every row agrees.
  const now = useNow()

  return (
    <div className={styles.shell}>
      {open && (
        <Sidebar
          chats={chats}
          now={now}
          onSettings={() => {
            // Settings is a surface of its own — not built yet.
          }}
        />
      )}

      <main className={styles.pane}>
        <header className={cx(styles.top, !open && styles.inset)}>
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
            <ModeSwitch value={chats.open?.mode ?? 'fast'} onChange={chats.setMode} />
          </div>
        </header>

        <Thread
          chat={chats.open}
          suggestions={demoSuggestions}
          onPickSuggestion={(label) => {
            setSeed(label)
          }}
        />

        <Composer
          draft={seed}
          onSend={(text) => {
            chats.send(text)
            setSeed(undefined)
          }}
        />
      </main>
    </div>
  )
}
