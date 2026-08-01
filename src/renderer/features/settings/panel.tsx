import styles from './panel.module.css'

type PanelProps = {
  title: string
  description?: string
  children: React.ReactNode
}

/** Every settings section uses this heading + stack so they line up. */
export function Panel({ title, description, children }: PanelProps): React.JSX.Element {
  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        {description !== undefined && <p className={styles.desc}>{description}</p>}
      </header>
      <div className={styles.stack}>{children}</div>
    </section>
  )
}

type RowProps = {
  label: string
  hint?: string
  /** Stacks the control under the label instead of beside it. */
  block?: boolean
  children: React.ReactNode
}

export function Row({ label, hint, block = false, children }: RowProps): React.JSX.Element {
  return (
    <div className={block ? styles.rowBlock : styles.row}>
      <div className={styles.labels}>
        <span className={styles.label}>{label}</span>
        {hint !== undefined && <span className={styles.hint}>{hint}</span>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  )
}

/** Placeholder for a section whose behaviour isn't built yet. */
export function NotYet({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className={styles.notYet}>{children}</p>
}
