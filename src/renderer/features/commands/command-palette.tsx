import { useState } from 'react'
import { Dialog, DialogHead } from '../../ui/dialog.js'
import { Bolt } from '../../ui/icons/bolt.js'
import styles from './command-palette.module.css'

type Props = {
  onClose: () => void
}

export function CommandPalette({ onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')

  return (
    <Dialog label="Command palette" placement="top" onClose={onClose} frameClassName={styles.frame}>
      <DialogHead>
        <div className={styles.prompt}>
          <span className={styles.glyph} aria-hidden="true">
            <Bolt size={16} />
          </span>
          <input
            autoFocus
            className={styles.input}
            value={query}
            placeholder="Type a command…"
            aria-label="Command"
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label="Close command palette"
          title="Close command palette"
          onClick={onClose}
        >
          Esc
        </button>
      </DialogHead>
      <div className={styles.empty}>
        <span className={styles.badge}>WIP</span>
        <p>Commands are coming soon.</p>
      </div>
    </Dialog>
  )
}
