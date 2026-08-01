import logo from '../../../../../assets/concepts/appLogo.png'
import { useAppInfo } from '../../../lib/use-app-info.js'
import styles from './about.module.css'

export function About(): React.JSX.Element {
  const info = useAppInfo()

  return (
    <section className={styles.about}>
      <img className={styles.mark} src={logo} alt="" width={72} height={72} />
      <h1 className={styles.name}>Luna</h1>

      {info?.ok === true && (
        <dl className={styles.facts}>
          <dt>Version</dt>
          <dd>{info.value.version}</dd>
          <dt>Electron</dt>
          <dd>{info.value.electron}</dd>
          <dt>Platform</dt>
          <dd>{info.value.platform}</dd>
        </dl>
      )}

      <p className={styles.legal}>Apache 2.0 licensed.</p>
    </section>
  )
}
