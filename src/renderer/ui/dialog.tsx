import { useEffect, useRef } from 'react'
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
  const frame = useRef<HTMLElement>(null)
  const previous = useRef<HTMLElement | undefined>(
    document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
  )

  useEffect(() => {
    const restore = previous.current

    function keepFocus(event: FocusEvent): void {
      const dialog = frame.current
      if (dialog === null || dialog.contains(event.target as Node)) return
      firstFocus(dialog)?.focus()
    }

    document.addEventListener('focusin', keepFocus)
    const dialog = frame.current
    if (dialog !== null && !dialog.contains(document.activeElement)) firstFocus(dialog)?.focus()

    return () => {
      document.removeEventListener('focusin', keepFocus)
      if (restore?.isConnected) restore.focus()
    }
  }, [])

  function trapTab(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Tab') return
    const items = focusable(event.currentTarget)
    const first = items[0]
    const last = items.at(-1)
    if (first === undefined || last === undefined) {
      event.preventDefault()
      event.currentTarget.focus()
      return
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className={cx(styles.backdrop, placement === 'top' ? styles.top : styles.center)}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section
        ref={frame}
        className={cx(styles.dialog, frameClassName)}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDownCapture={trapTab}
      >
        {children}
      </section>
    </div>
  )
}

function focusable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
}

function firstFocus(dialog: HTMLElement): HTMLElement | undefined {
  return focusable(dialog)[0] ?? dialog
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
