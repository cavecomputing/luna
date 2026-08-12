import styles from './segmented.module.css'
import { cx } from '../lib/cx.js'

export type Segment<T extends string> = {
  value: T
  label: string
  icon: React.ReactNode
  tooltip?: string
}

type Props<T extends string> = {
  /** Names the group for screen readers, e.g. "Response mode". */
  label: string
  value: T
  segments: Segment<T>[]
  onChange: (value: T) => void
  size?: 'regular' | 'compact'
}

/** Two-or-more exclusive choices in a pill. Generic so it isn't tied to Mode. */
export function Segmented<T extends string>({
  label,
  value,
  segments,
  onChange,
  size = 'regular',
}: Props<T>): React.JSX.Element {
  return (
    <div
      className={cx(styles.group, size === 'compact' && styles.compact)}
      role="radiogroup"
      aria-label={label}
      data-size={size}
    >
      {segments.map((seg) => (
        <button
          key={seg.value}
          type="button"
          role="radio"
          aria-checked={seg.value === value}
          aria-description={seg.tooltip}
          data-tooltip={seg.tooltip}
          className={cx(styles.seg, seg.value === value && styles.on)}
          onClick={() => {
            onChange(seg.value)
          }}
        >
          <span className={styles.icon}>{seg.icon}</span>
          {seg.label}
        </button>
      ))}
    </div>
  )
}
