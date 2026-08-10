import { useState } from 'react'
import { IconButton } from '../../ui/icon-button.js'
import { X } from '../../ui/icons/x.js'
import styles from './command-palette.module.css'

type Props = {
  onClose: () => void
}

export function CommandPalette({ onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Command palette">
        <header className={styles.head}>
          <input
            autoFocus
            value={query}
            placeholder="Type a command…"
            aria-label="Command"
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          <IconButton label="Close command palette" onClick={onClose}>
            <X />
          </IconButton>
        </header>
        <div className={styles.empty}>
          <span className={styles.badge}>WIP</span>
          <p>Commands are coming soon.</p>
        </div>
      </section>
    </div>
  )
}
