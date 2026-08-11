import { NotYet, Panel } from '../panel.js'
import styles from './privacy.module.css'

export function Privacy(): React.JSX.Element {
  return (
    <Panel title="Privacy" description="Where your conversations live and how to remove them.">
      <p className={styles.note}>
        Luna talks only to the endpoints you configure. Nothing is sent anywhere else, and
        there is no telemetry.
      </p>
      <NotYet>
        Conversations live in a local database on this computer. Export and delete-all are
        coming; API keys can already be removed under Providers.
      </NotYet>
    </Panel>
  )
}
