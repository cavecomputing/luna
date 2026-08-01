import styles from './toggle.module.css'

type Props = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/** A switch, styled like the macOS one. */
export function Toggle({ label, checked, onChange }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.track}
      onClick={() => {
        onChange(!checked)
      }}
    >
      <span className={styles.knob} />
    </button>
  )
}
