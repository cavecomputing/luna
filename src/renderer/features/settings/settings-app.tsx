import { useState } from 'react'
import { sections, type SectionId } from './sections.js'
import { usePrefs } from '../../lib/use-prefs.js'
import { Appearance } from './panels/appearance.js'
import { About } from './panels/about.js'
import { Chat } from './panels/chat.js'
import { Models } from './panels/models.js'
import { Privacy } from './panels/privacy.js'
import { Providers } from './panels/providers.js'
import { cx } from '../../lib/cx.js'
import styles from './settings-app.module.css'

export function SettingsApp(): React.JSX.Element {
  const [active, setActive] = useState<SectionId>('providers')
  const prefs = usePrefs()

  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="Settings sections">
        <div className={styles.drag} />
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={cx(styles.tab, section.id === active && styles.on)}
            aria-current={section.id === active ? 'page' : undefined}
            onClick={() => {
              setActive(section.id)
            }}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <main className={styles.panel} key={active}>
        <div className={styles.drag} />
        {active === 'providers' && <Providers />}
        {active === 'models' && <Models />}
        {active === 'chat' && <Chat prefs={prefs} />}
        {active === 'appearance' && <Appearance prefs={prefs} />}
        {active === 'privacy' && <Privacy />}
        {active === 'about' && <About />}
      </main>
    </div>
  )
}
