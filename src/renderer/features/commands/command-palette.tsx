import { useState } from 'react'
import { Dialog, DialogHead } from '../../ui/dialog.js'
import { IconButton } from '../../ui/icon-button.js'
import { X } from '../../ui/icons/x.js'
import styles from './command-palette.module.css'

type Props = {
  onClose: () => void
}

export function CommandPalette({ onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')

  return (
    <Dialog label="Command palette" placement="top" onClose={onClose} frameClassName={styles.frame}>
      <DialogHead>
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
        <IconButton label="Close command palette" onClick={onClose}>
          <X />
        </IconButton>
      </DialogHead>
      <div className={styles.empty}>
        <span className={styles.badge}>WIP</span>
        <p>Commands are coming soon.</p>
      </div>
    </Dialog>
  )
}
