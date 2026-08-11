import { cx } from '../lib/cx.js'
import styles from './dialog.module.css'

type Props = {
  /** Accessible name of the dialog. */
  label: string
  /** center: on top of everything. top: under the title bar, palette style. */
  placement: 'center' | 'top'
  onClose: () => void
  /** Width and other sizing for the dialog box itself. */
  frameClassName?: string | undefined
  children: React.ReactNode
}

/** Modal overlay. A click on the backdrop, outside the dialog, closes it. */
export function Dialog({
  label,
  placement,
  onClose,
  frameClassName,
  children,
}: Props): React.JSX.Element {
  return (
    <div
      className={cx(styles.backdrop, placement === 'top' ? styles.top : styles.center)}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        className={cx(styles.dialog, frameClassName)}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </section>
    </div>
  )
}

/** The input row every dialog starts with. */
export function DialogHead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <header className={styles.head}>{children}</header>
}

/** Compact pointer and keyboard affordance for dismissing a dialog. */
export function DialogClose({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.close}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      Esc
    </button>
  )
}
