import styles from './icon-button.module.css'
import { cx } from '../lib/cx.js'

type Props = {
  /** Accessible name. Icon-only buttons have no text of their own. */
  label: string
  children: React.ReactNode
  onClick?: () => void
  variant?: 'ghost' | 'accent'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
}

export function IconButton({
  label,
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled = false,
}: Props): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(styles.btn, styles[variant], styles[size])}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
