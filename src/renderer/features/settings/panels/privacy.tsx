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
        Conversation storage, export and delete-all arrive with persistence. Key removal
        arrives with the Keychain work.
      </NotYet>
    </Panel>
  )
}
