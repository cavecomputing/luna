import logo from '../../../../assets/concepts/appLogo.png'
import styles from './greeting.module.css'

/** Shown when a conversation has no messages yet. */
export function Greeting(): React.JSX.Element {
  return (
    <div className={styles.greeting}>
      <img className={styles.mark} src={logo} alt="" width={56} height={56} />
      <h2 className={styles.hello}>Hey there! I&rsquo;m Luna.</h2>
      <p className={styles.sub}>How can I help you today?</p>
    </div>
  )
}
