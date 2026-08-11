import {
  keyboardShortcutOrder,
  keyboardShortcuts,
  shortcutKeys,
} from '../../../shared/keyboard-shortcuts.js'
import styles from './shortcuts-app.module.css'

export function ShortcutsApp(): React.JSX.Element {
  return (
    <main className={styles.shell}>
      <div className={styles.chrome} aria-hidden="true" />
      <div className={styles.scroll}>
        <header className={styles.head}>
          <h1>Keyboard Shortcuts</h1>
          <p>Move around Luna without leaving the keyboard.</p>
        </header>

        <dl className={styles.list}>
          {keyboardShortcutOrder.map((id) => (
            <div className={styles.row} key={id}>
              <dt>{keyboardShortcuts[id].label}</dt>
              <dd>
                {shortcutKeys(id, window.luna.platform).map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  )
}
