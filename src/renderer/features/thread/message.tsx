import type { Message as Msg } from '../../../shared/types.js'
import { clock } from '../../lib/time.js'
import { toBlocks } from './blocks.js'
import logo from '../../../../assets/concepts/appLogo.png'
import styles from './message.module.css'
import { cx } from '../../lib/cx.js'

type Props = {
  message: Msg
}

export function Message({ message }: Props): React.JSX.Element {
  const mine = message.role === 'user'

  return (
    <article className={cx(styles.row, mine ? styles.mine : styles.theirs)}>
      {!mine && <img className={styles.avatar} src={logo} alt="Luna" width={28} height={28} />}

      <div className={styles.bubble}>
        <div className={styles.body}>
          {/* Blocks are derived from immutable text and never reorder, so
              position is a stable identity here. */}
          {toBlocks(message.text).map((block, i) =>
            block.kind === 'para' ? (
              <p key={`p${String(i)}`} className={styles.para}>
                {block.text}
              </p>
            ) : (
              <ul key={`l${String(i)}`} className={styles.list}>
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </div>
        <time className={styles.when} dateTime={new Date(message.at).toISOString()}>
          {clock(message.at)}
        </time>
      </div>
    </article>
  )
}
