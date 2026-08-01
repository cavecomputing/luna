import { Avatar } from '../../ui/avatar.js'
import styles from './greeting.module.css'

/** Shown when a conversation has no messages yet. */
export function Greeting(): React.JSX.Element {
  return (
    <div className={styles.greeting}>
      {/* The heading names her, so the image is decorative. */}
      <div className={styles.mark}>
        <Avatar size={72} alt="" />
      </div>
      <h2 className={styles.hello}>Hey there! I&rsquo;m Luna.</h2>
      <p className={styles.sub}>How can I help you today?</p>
    </div>
  )
}
